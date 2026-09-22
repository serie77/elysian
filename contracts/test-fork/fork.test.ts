/**
 * Mainnet fork: deploys Elysian onto a fork of Robinhood Chain and moves REAL tokens through it.
 * For each token we find a live holder from recent Transfer logs, impersonate it, and run
 * shield -> private transfer -> unshield with real Groth16 proofs.
 *
 *   FORK=1 npx hardhat test test-fork/fork.test.ts
 */
import { expect } from 'chai';
import { config, ethers, network } from 'hardhat';
import type { Contract } from 'ethers';
import { deployHasher, hex, loadCore, prove, unhex, type CoreModule, domainOf } from '../test/helpers';

const RPC = config.networks.hardhat.forking?.url ?? '';
const TOKENS: Record<string, string> = {
  NVDA: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
  TSLA: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
  AAPL: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
  SPY: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
  USDG: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
};
const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];
const LEVELS = 20;
let core: CoreModule;

/**
 * Walk back through Transfer logs until a recipient holds a balance AT THE FORK BLOCK. Logs come
 * from the live RPC (the fork cannot serve them cheaply); balances are read from the fork so the
 * holder is guaranteed to be funded in the state we actually execute against. Busy tokens blow
 * the RPC result cap, so the block range shrinks until a query fits.
 */
async function findHolder(token: string): Promise<{ holder: string; balance: bigint } | null> {
  const live = new ethers.JsonRpcProvider(RPC);
  const logsFrom = new ethers.Contract(token, erc20Abi, live);
  const onFork = new ethers.Contract(token, erc20Abi, ethers.provider);
  const forkBlock = await ethers.provider.getBlockNumber();
  let step = 20_000;
  let to = forkBlock;
  let queries = 0;
  while (to > 0 && queries < 120) {
    queries++;
    let logs;
    try {
      logs = await logsFrom.queryFilter(logsFrom.filters.Transfer(), Math.max(0, to - step + 1), to);
    } catch {
      if (step > 50) {
        step = Math.floor(step / 8);
        continue;
      }
      to -= step;
      continue;
    }
    const seen = new Set<string>();
    for (const log of logs.reverse()) {
      const recipient = (log as any).args[1] as string;
      if (recipient === ethers.ZeroAddress || seen.has(recipient)) continue;
      seen.add(recipient);
      const balance: bigint = await onFork.balanceOf(recipient);
      if (balance >= 10_000n) return { holder: recipient, balance };
      if (seen.size > 30) break;
    }
    to -= step;
  }
  return null;
}

describe('Elysian on a Robinhood Chain mainnet fork', function () {
  this.timeout(1_200_000);
  let pool: Contract;

  before(async function () {
    if (!process.env.FORK) this.skip();
    core = await loadCore();
    const [deployer] = await ethers.getSigners();
    const hasher = await deployHasher(deployer);
    const verifier = await (await ethers.getContractFactory('TransactionVerifier')).deploy();
    pool = (await (await ethers.getContractFactory('ElysianPool')).deploy(await verifier.getAddress(), await hasher.getAddress(), LEVELS, await deployer.getAddress())) as unknown as Contract;
    console.log(`      forked at block ${await ethers.provider.getBlockNumber()}, pool ${await pool.getAddress()}`);
  });

  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const [symbol, token] of Object.entries(TOKENS).filter(([s]) => !only || only.includes(s))) {
    it(`shields, privately transfers and unshields real ${symbol}`, async function () {
      const found = await findHolder(token);
      if (!found) {
        console.log(`      no recent holder found for ${symbol}; skipping`);
        this.skip();
      }
      const { holder, balance } = found!;
      const amount = balance / 4n > 0n ? balance / 4n : balance;
      await network.provider.send('hardhat_impersonateAccount', [holder]);
      await network.provider.send('hardhat_setBalance', [holder, '0x56BC75E2D63100000']);
      const signer = await ethers.getSigner(holder);
      const erc20 = new ethers.Contract(token, erc20Abi, signer);
      const poolAddr = await pool.getAddress();

      const tree = new core.MerkleTree(LEVELS);
      const records: Core.CommitmentRecord[] = [];
      const spent = new Set<bigint>();
      const sync = async () => {
        for (const ev of await pool.queryFilter(pool.filters.NewCommitment())) {
          const [commitment, index, ciphertext] = (ev as any).args as [string, bigint, string];
          if (Number(index) < tree.size) continue;
          tree.insert(BigInt(commitment));
          records.push({ commitment: BigInt(commitment), index: Number(index), ciphertext: unhex(ciphertext) });
        }
        for (const ev of await pool.queryFilter(pool.filters.NewNullifier())) spent.add(BigInt((ev as any).args[0]));
      };
      const notesOf = (k: Core.SpendingKey) => core.scanCommitments(k, records).filter((n) => !spent.has(n.nullifier) && n.amount > 0n && n.asset === core.assetToId(token));

      const build = async (key: Core.SpendingKey, inputs: Core.OwnedNote[], outputs: { note: Core.Note; to: Core.ShieldedAddress }[], extAmount: bigint, recipient = ethers.ZeroAddress) => {
        const assetId = core.assetToId(token);
        const outs = [...outputs];
        while (outs.length < 2) outs.push({ note: core.dummyNote(assetId, key.pk), to: key.address() });
        const ext: Core.ExtData = {
          recipient: recipient as `0x${string}`,
          extAmount,
          relayer: ethers.ZeroAddress as `0x${string}`,
          fee: 0n,
          encryptedOutput1: core.encryptTo(outs[0].to.encPub, core.serializeNote(outs[0].note)),
          encryptedOutput2: core.encryptTo(outs[1].to.encPub, core.serializeNote(outs[1].note)),
          adapterData: new Uint8Array(),
        };
        const edh = core.extDataHash(ext, await domainOf(pool));
        const w = core.buildTransactionWitness({
          key,
          assetId,
          inputs: inputs.map((n) => ({ note: n, leafIndex: n.leafIndex, path: tree.path(n.leafIndex) })),
          outputs: outs.map((o) => o.note),
          publicAmount: core.publicAmount(extAmount, 0n),
          extDataHash: edh,
          tree,
        });
        const { proof } = await prove('transaction', w.circuitInputs);
        return {
          args: {
            proof: core.encodeProof(proof),
            root: core.toHex32(w.root),
            inputNullifiers: w.inputNullifiers.map(core.toHex32),
            outputCommitments: w.outputCommitments.map(core.toHex32),
            publicAmount: core.publicAmount(extAmount, 0n),
            assetId,
            extDataHash: core.toHex32(edh),
          },
          ext: { ...ext, encryptedOutput1: hex(ext.encryptedOutput1), encryptedOutput2: hex(ext.encryptedOutput2), adapterData: '0x' },
        };
      };

      const alice = core.SpendingKey.random();
      const bob = core.SpendingKey.random();
      const poolBefore: bigint = await erc20.balanceOf(poolAddr);

      // shield
      await sync();
      let tx = await build(alice, [], [{ note: core.createNote(token, amount, alice.pk), to: alice.address() }], amount);
      await (await erc20.approve(poolAddr, amount)).wait();
      await (await (pool.connect(signer) as Contract).transact(tx.args, tx.ext)).wait();
      expect((await erc20.balanceOf(poolAddr)) - poolBefore).to.equal(amount);
      await sync();
      expect(notesOf(alice).reduce((a, n) => a + n.amount, 0n)).to.equal(amount);

      // private transfer of half to bob
      const half = amount / 2n;
      const [note] = notesOf(alice);
      tx = await build(alice, [note], [{ note: core.createNote(token, half, bob.pk), to: bob.address() }, { note: core.createNote(token, amount - half, alice.pk), to: alice.address() }], 0n);
      await (await (pool.connect(signer) as Contract).transact(tx.args, tx.ext)).wait();
      await sync();
      expect(notesOf(bob).reduce((a, n) => a + n.amount, 0n)).to.equal(half);

      // bob unshields to a fresh address
      const fresh = ethers.Wallet.createRandom().address;
      const [bobNote] = notesOf(bob);
      tx = await build(bob, [bobNote], [], -half, fresh);
      await (await (pool.connect(signer) as Contract).transact(tx.args, tx.ext)).wait();
      expect(await erc20.balanceOf(fresh)).to.equal(half);
      const dec = Number(await erc20.decimals());
      console.log(`      ${symbol}: holder ${holder.slice(0, 10)}… shielded ${ethers.formatUnits(amount, dec)}, sent ${ethers.formatUnits(half, dec)} privately, unshielded to ${fresh.slice(0, 10)}…`);
    });
  }
});

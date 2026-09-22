/**
 * Mainnet fork: private trades into REAL launchpad tokens through REAL Uniswap v3 liquidity.
 * Nothing about these tokens is registered anywhere in Elysian; the adapter finds the pools.
 *
 *   FORK=1 npx hardhat test test-fork/trade.fork.test.ts
 */
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import type { Contract } from 'ethers';
import { UNISWAP } from '../scripts/uniswap';
import { deployHasher, hex, loadCore, prove, unhex, type CoreModule, domainOf } from '../test/helpers';

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const AI = '0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18'; // Artificial Inu, launched on long.xyz
const PONS = '0x39dBED3a2bd333467115dE45665cC57F813C4571'; // Pons launchpad token
const LEVELS = 20;
const BATCH = 60;
const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function deposit() payable',
];
let core: CoreModule;

describe('Private trading of launchpad tokens on a Robinhood Chain mainnet fork', function () {
  this.timeout(1_200_000);
  let pool: Contract;
  let swap: Contract;
  let adapter: Contract;
  let trader: Awaited<ReturnType<typeof ethers.getSigners>>[number];

  let tree: InstanceType<CoreModule['MerkleTree']>;
  let swapTree: InstanceType<CoreModule['MerkleTree']>;
  const records: Core.CommitmentRecord[] = [];
  const swaps: Core.SwapRecord[] = [];
  const spent = new Set<bigint>();

  const token = (address: string) => new ethers.Contract(address, erc20Abi, trader);

  async function sync() {
    for (const ev of await pool.queryFilter(pool.filters.NewCommitment())) {
      const [commitment, index, ciphertext] = (ev as any).args as [string, bigint, string];
      if (Number(index) < tree.size) continue;
      tree.insert(BigInt(commitment));
      records.push({ commitment: BigInt(commitment), index: Number(index), ciphertext: unhex(ciphertext) });
    }
    for (const ev of await pool.queryFilter(pool.filters.NewNullifier())) spent.add(BigInt((ev as any).args[0]));
    for (const ev of await swap.queryFilter(swap.filters.SwapIntent())) {
      const [commitment, index, batchId, assetIn, assetOut, amountIn, ciphertext] = (ev as any).args;
      if (Number(index) < swapTree.size) continue;
      swapTree.insert(BigInt(commitment));
      swaps.push({ commitment: BigInt(commitment), index: Number(index), batchId: BigInt(batchId), assetIn: BigInt(assetIn), assetOut: BigInt(assetOut), amountIn: BigInt(amountIn), ciphertext: unhex(ciphertext) });
    }
  }

  const notesOf = (key: Core.SpendingKey, asset: string) =>
    core.scanCommitments(key, records).filter((n) => !spent.has(n.nullifier) && n.amount > 0n && n.asset === core.assetToId(asset));

  /** Proves and sends one pool transaction: shield (ext > 0), unshield or adapter call (ext < 0). */
  async function transact(key: Core.SpendingKey, asset: string, inputs: Core.OwnedNote[], outputs: Core.Note[], extAmount: bigint, recipient = ethers.ZeroAddress, adapterData = new Uint8Array()) {
    const assetId = core.assetToId(asset);
    const outs = [...outputs];
    while (outs.length < 2) outs.push(core.dummyNote(assetId, key.pk));
    const ext: Core.ExtData = {
      recipient: recipient as `0x${string}`,
      extAmount,
      relayer: ethers.ZeroAddress as `0x${string}`,
      fee: 0n,
      encryptedOutput1: core.encryptTo(key.encPub, core.serializeNote(outs[0])),
      encryptedOutput2: core.encryptTo(key.encPub, core.serializeNote(outs[1])),
      adapterData,
    };
    const edh = core.extDataHash(ext, await domainOf(pool));
    const w = core.buildTransactionWitness({
      key,
      assetId,
      inputs: inputs.map((n) => ({ note: n, leafIndex: n.leafIndex, path: tree.path(n.leafIndex) })),
      outputs: outs,
      publicAmount: core.publicAmount(extAmount, 0n),
      extDataHash: edh,
      tree,
    });
    const { proof } = await prove('transaction', w.circuitInputs);
    const args = {
      proof: core.encodeProof(proof),
      root: core.toHex32(w.root),
      inputNullifiers: w.inputNullifiers.map(core.toHex32),
      outputCommitments: w.outputCommitments.map(core.toHex32),
      publicAmount: core.publicAmount(extAmount, 0n),
      assetId,
      extDataHash: core.toHex32(edh),
    };
    await (await pool.transact(args, { ...ext, encryptedOutput1: hex(ext.encryptedOutput1), encryptedOutput2: hex(ext.encryptedOutput2), adapterData: hex(adapterData) })).wait();
    await sync();
  }

  /** The whole private trade: shield, sealed intent, batch clears on Uniswap, claim, unshield. */
  async function tradePrivately(assetIn: string, assetOut: string, amountIn: bigint, label: string) {
    const key = core.SpendingKey.random();
    const poolAddr = await pool.getAddress();
    const swapAddr = await swap.getAddress();
    const inId = core.assetToId(assetIn);
    const outId = core.assetToId(assetOut);

    await (await token(assetIn).approve(poolAddr, amountIn)).wait();
    await transact(key, assetIn, [], [core.createNote(inId, amountIn, key.pk)], amountIn);

    // Pin the chain to the start of a batch so proving cannot straddle a boundary.
    const latest = await ethers.provider.getBlock('latest');
    const batchStart = (Math.floor(latest!.timestamp / BATCH) + 1) * BATCH;
    await network.provider.send('evm_setNextBlockTimestamp', [batchStart]);
    await network.provider.send('evm_mine');
    const batchId: bigint = await swap.currentBatch();
    const intent: Core.SwapIntent = { batchId, assetIn: inId, assetOut: outId, amountIn, pk: key.pk, blinding: core.randomField() };
    const commitment = core.swapCommitment(intent);
    const ciphertext = core.encryptTo(key.encPub, core.serializeSwap(intent));
    await transact(key, assetIn, notesOf(key, assetIn).slice(0, 1), [], -amountIn, swapAddr, core.encodeSwapAdapterData(assetOut as `0x${string}`, core.swapOwnerTag(intent), batchId, ciphertext));

    await network.provider.send('evm_increaseTime', [BATCH + 1]);
    await network.provider.send('evm_mine');
    const [path, quoted]: [string, bigint] = await adapter.route.staticCall(assetIn, assetOut, amountIn);
    await (await swap.executeBatch(assetIn, assetOut, batchId, (quoted * 99n) / 100n)).wait();
    const batch = await swap.getBatch(assetIn, assetOut, batchId);
    expect(batch.totalOut).to.be.greaterThan(0n);

    await sync();
    const owned = core.scanSwaps(key, swaps).find((s) => s.batchId === batchId && s.assetOut === outId)!;
    const w = core.buildSwapClaimWitness({ key, domain: await domainOf(swap), encPub: key.encPub, swap: owned, path: swapTree.path(owned.leafIndex), totalIn: batch.totalIn, totalOut: batch.totalOut, outBlinding: core.randomField() });
    const { proof } = await prove('swapClaim', w.circuitInputs);
    await (
      await swap.claim({
        proof: core.encodeProof(proof),
        swapRoot: core.toHex32(w.swapRoot),
        batchId,
        assetIn,
        assetOut,
        nullifier: core.toHex32(w.nullifier),
        outputCommitment: core.toHex32(w.outputCommitment),
        encryptedOutput: hex(w.encryptedOutput),
      })
    ).wait();
    await sync();
    const [bought] = notesOf(key, assetOut);
    expect(bought.amount).to.equal(batch.totalOut);

    const fresh = ethers.Wallet.createRandom().address;
    await transact(key, assetOut, [bought], [], -bought.amount, fresh);
    expect(await token(assetOut).balanceOf(fresh)).to.equal(bought.amount);

    const hops = (ethers.getBytes(path).length - 20) / 23;
    const dec = async (a: string) => Number(await token(a).decimals());
    console.log(`      ${label}: ${ethers.formatUnits(amountIn, await dec(assetIn))} in, ${ethers.formatUnits(bought.amount, await dec(assetOut))} out, ${hops === 1 ? 'direct pool' : 'routed through WETH'}, withdrawn to ${fresh.slice(0, 10)}…`);
  }

  before(async function () {
    if (!process.env.FORK) this.skip();
    core = await loadCore();
    tree = new core.MerkleTree(LEVELS);
    swapTree = new core.MerkleTree(LEVELS);
    [trader] = await ethers.getSigners();
    const owner = await trader.getAddress();
    const hasher = await deployHasher(trader);
    const txVerifier = await (await ethers.getContractFactory('TransactionVerifier')).deploy();
    const claimVerifier = await (await ethers.getContractFactory('SwapClaimVerifier')).deploy();
    pool = (await (await ethers.getContractFactory('ElysianPool')).deploy(await txVerifier.getAddress(), await hasher.getAddress(), LEVELS, owner)) as unknown as Contract;
    adapter = (await (await ethers.getContractFactory('UniswapV3Adapter')).deploy(UNISWAP.router, UNISWAP.quoter, UNISWAP.factory, UNISWAP.weth)) as unknown as Contract;
    swap = (await (await ethers.getContractFactory('ElysianSwap')).deploy(await pool.getAddress(), await claimVerifier.getAddress(), await hasher.getAddress(), LEVELS, BATCH, await adapter.getAddress(), owner)) as unknown as Contract;
    await (await pool.setAdapter(await swap.getAddress(), true)).wait();
    await (await swap.setExecutor(owner, true)).wait();
    await (await token(UNISWAP.weth).deposit({ value: ethers.parseEther('3') })).wait();
    console.log(`      forked at block ${await ethers.provider.getBlockNumber()}`);
  });

  it('buys Artificial Inu with shielded WETH', async () => {
    await tradePrivately(UNISWAP.weth, AI, ethers.parseEther('0.5'), 'WETH -> AI');
  });

  it('buys PONS with shielded USDG, a pair with no pool of its own', async () => {
    // Get some USDG the ordinary way first, straight through the adapter.
    const weth = token(UNISWAP.weth);
    await (await weth.approve(await adapter.getAddress(), ethers.parseEther('1'))).wait();
    await (await adapter.swap(UNISWAP.weth, USDG, ethers.parseEther('1'), 0, await trader.getAddress())).wait();
    const usdg: bigint = await token(USDG).balanceOf(await trader.getAddress());
    expect(usdg).to.be.greaterThan(0n);
    await tradePrivately(USDG, PONS, usdg / 2n, 'USDG -> PONS');
  });

  it('sells Artificial Inu back into a stock token', async () => {
    const weth = token(UNISWAP.weth);
    await (await weth.approve(await adapter.getAddress(), ethers.parseEther('0.5'))).wait();
    await (await adapter.swap(UNISWAP.weth, AI, ethers.parseEther('0.5'), 0, await trader.getAddress())).wait();
    const ai: bigint = await token(AI).balanceOf(await trader.getAddress());
    await tradePrivately(AI, '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', ai, 'AI -> NVDA');
  });
});

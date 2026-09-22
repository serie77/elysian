import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import type { Contract, Signer } from 'ethers';
import { artifactsAvailable, deployHasher, hex, loadCore, prove, unhex, type CoreModule, domainOf } from './helpers';

const LEVELS = 20;
const BATCH = 60n;
const E18 = 10n ** 18n;

let core: CoreModule;

describe('Elysian', function () {
  before(async function () {
    if (!artifactsAvailable('transaction') || !artifactsAvailable('swapClaim')) {
      throw new Error('circuit artifacts missing: run `npm run circuits` first');
    }
    core = await loadCore();
  });

  /* --------------------------------- fixture --------------------------------- */

  interface Env {
    deployer: Signer;
    alice: Signer;
    bob: Signer;
    relayer: Signer;
    executor: Signer;
    pool: Contract;
    swap: Contract;
    dex: Contract;
    nvda: Contract;
    usdg: Contract;
  }

  async function deployAll(): Promise<Env> {
    const [deployer, alice, bob, relayer, executor] = await ethers.getSigners();
    const hasher = await deployHasher(deployer);
    const txVerifier = await (await ethers.getContractFactory('TransactionVerifier')).deploy();
    const claimVerifier = await (await ethers.getContractFactory('SwapClaimVerifier')).deploy();
    const pool = await (await ethers.getContractFactory('ElysianPool')).deploy(
      await txVerifier.getAddress(),
      await hasher.getAddress(),
      LEVELS,
      await deployer.getAddress(),
    );
    const dex = await (await ethers.getContractFactory('MockDex')).deploy();
    const swap = await (await ethers.getContractFactory('ElysianSwap')).deploy(
      await pool.getAddress(),
      await claimVerifier.getAddress(),
      await hasher.getAddress(),
      LEVELS,
      BATCH,
      await dex.getAddress(),
      await deployer.getAddress(),
    );
    await pool.setAdapter(await swap.getAddress(), true);
    await swap.setExecutor(await executor.getAddress(), true);

    const Token = await ethers.getContractFactory('MockERC20');
    const nvda = await Token.deploy('NVIDIA Robinhood Token', 'NVDA');
    const usdg = await Token.deploy('Global Dollar', 'USDG');
    await nvda.mint(await alice.getAddress(), 1_000n * E18);
    await nvda.mint(await dex.getAddress(), 10_000n * E18);
    await usdg.mint(await dex.getAddress(), 1_800_000n * E18);

    return { deployer, alice, bob, relayer, executor, pool, swap, dex, nvda, usdg } as unknown as Env;
  }

  /* ------------------------------ client mirror ------------------------------ */

  /** Everything a wallet needs: a mirror of both trees plus the ciphertext log. */
  class Client {
    tree: InstanceType<CoreModule['MerkleTree']>;
    swapTree: InstanceType<CoreModule['MerkleTree']>;
    commitments: Core.CommitmentRecord[] = [];
    swaps: Core.SwapRecord[] = [];
    spent = new Set<bigint>();

    constructor(public env: Env) {
      this.tree = new core.MerkleTree(LEVELS);
      this.swapTree = new core.MerkleTree(LEVELS);
    }

    async sync() {
      const { pool, swap } = this.env;
      const newCommitments = await pool.queryFilter(pool.filters.NewCommitment());
      for (const ev of newCommitments) {
        const [commitment, index, ciphertext] = (ev as any).args as [string, bigint, string];
        const i = Number(index);
        if (i < this.tree.size) continue;
        this.tree.insert(BigInt(commitment));
        this.commitments.push({ commitment: BigInt(commitment), index: i, ciphertext: unhex(ciphertext) });
      }
      const nullifiers = await pool.queryFilter(pool.filters.NewNullifier());
      for (const ev of nullifiers) this.spent.add(BigInt((ev as any).args[0]));

      const intents = await swap.queryFilter(swap.filters.SwapIntent());
      for (const ev of intents) {
        const [commitment, index, batchId, assetIn, assetOut, amountIn, ciphertext] = (ev as any).args;
        const i = Number(index);
        if (i < this.swapTree.size) continue;
        this.swapTree.insert(BigInt(commitment));
        this.swaps.push({
          commitment: BigInt(commitment),
          index: i,
          batchId: BigInt(batchId),
          assetIn: BigInt(assetIn),
          assetOut: BigInt(assetOut),
          amountIn: BigInt(amountIn),
          ciphertext: unhex(ciphertext),
        });
      }
    }

    notes(key: Core.SpendingKey) {
      return core.scanCommitments(key, this.commitments).filter((n) => !this.spent.has(n.nullifier) && n.amount > 0n);
    }

    balance(key: Core.SpendingKey, asset: bigint) {
      return this.notes(key)
        .filter((n) => n.asset === asset)
        .reduce((a, n) => a + n.amount, 0n);
    }
  }

  const ZERO = core?.ZERO_ADDRESS ?? '0x0000000000000000000000000000000000000000';

  interface TxParams {
    key: Core.SpendingKey;
    asset: string;
    inputs: Core.OwnedNote[];
    outputs: Core.Note[];
    outputRecipients: Core.ShieldedAddress[]; // who each output is encrypted to
    extAmount: bigint;
    recipient?: string;
    relayer?: string;
    fee?: bigint;
    adapterData?: Uint8Array;
  }

  /** Builds ExtData + proof for a transaction. Returns what ElysianPool.transact wants. */
  async function buildTransact(client: Client, p: TxParams) {
    const assetId = core.assetToId(p.asset);
    const outputs = [...p.outputs];
    const recipients = [...p.outputRecipients];
    while (outputs.length < 2) {
      outputs.push(core.dummyNote(assetId, p.key.pk));
      recipients.push(p.key.address());
    }
    const ext: Core.ExtData = {
      recipient: (p.recipient ?? ZERO) as `0x${string}`,
      extAmount: p.extAmount,
      relayer: (p.relayer ?? ZERO) as `0x${string}`,
      fee: p.fee ?? 0n,
      encryptedOutput1: core.encryptTo(recipients[0].encPub, core.serializeNote(outputs[0])),
      encryptedOutput2: core.encryptTo(recipients[1].encPub, core.serializeNote(outputs[1])),
      adapterData: p.adapterData ?? new Uint8Array(),
    };
    const edh = core.extDataHash(ext, await domainOf(client.env.pool));
    const witness = core.buildTransactionWitness({
      key: p.key,
      assetId,
      inputs: p.inputs.map((n) => ({ note: n, leafIndex: n.leafIndex, path: client.tree.path(n.leafIndex) })),
      outputs,
      publicAmount: core.publicAmount(ext.extAmount, ext.fee),
      extDataHash: edh,
      tree: client.tree,
    });
    const { proof } = await prove('transaction', witness.circuitInputs);
    const args = {
      proof: core.encodeProof(proof),
      root: core.toHex32(witness.root),
      inputNullifiers: witness.inputNullifiers.map(core.toHex32),
      outputCommitments: witness.outputCommitments.map(core.toHex32),
      publicAmount: core.publicAmount(ext.extAmount, ext.fee),
      assetId,
      extDataHash: core.toHex32(edh),
    };
    const extSol = {
      recipient: ext.recipient,
      extAmount: ext.extAmount,
      relayer: ext.relayer,
      fee: ext.fee,
      encryptedOutput1: hex(ext.encryptedOutput1),
      encryptedOutput2: hex(ext.encryptedOutput2),
      adapterData: hex(ext.adapterData),
    };
    return { args, extSol, ext };
  }

  /* ---------------------------------- tests ---------------------------------- */

  it('ExtData hashing matches Solidity abi.encode', async () => {
    const ext: Core.ExtData = {
      recipient: '0x1111111111111111111111111111111111111111',
      extAmount: -5n,
      relayer: '0x2222222222222222222222222222222222222222',
      fee: 7n,
      encryptedOutput1: new Uint8Array([1, 2, 3]),
      encryptedOutput2: new Uint8Array(40).fill(9),
      adapterData: new Uint8Array(),
    };
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(address,int256,address,uint256,bytes,bytes,bytes)'],
      [[ext.recipient, ext.extAmount, ext.relayer, ext.fee, hex(ext.encryptedOutput1), hex(ext.encryptedOutput2), '0x']],
    );
    expect(hex(core.encodeExtData(ext))).to.equal(encoded);

    const swapData = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes32', 'uint256', 'bytes'],
      [ext.recipient, core.toHex32(123n), 42n, hex(ext.encryptedOutput2)],
    );
    expect(hex(core.encodeSwapAdapterData(ext.recipient, 123n, 42n, ext.encryptedOutput2))).to.equal(swapData);
  });

  it('empty tree root matches the client mirror', async () => {
    const env = await deployAll();
    const tree = new core.MerkleTree(LEVELS);
    expect(await env.pool.getLastRoot()).to.equal(core.toHex32(tree.root));
  });

  it('shield, private transfer, unshield through a relayer, and reject double spends', async function () {
    const env = await deployAll();
    const { pool, nvda, alice, bob, relayer } = env;
    const client = new Client(env);
    const aliceKey = core.SpendingKey.random();
    const bobKey = core.SpendingKey.random();
    const nvdaAddr = await nvda.getAddress();
    const nvdaId = core.assetToId(nvdaAddr);
    const poolAddr = await pool.getAddress();

    // -- shield 100 NVDA
    await client.sync();
    const shieldNote = core.createNote(nvdaId, 100n * E18, aliceKey.pk);
    let tx = await buildTransact(client, {
      key: aliceKey,
      asset: nvdaAddr,
      inputs: [],
      outputs: [shieldNote],
      outputRecipients: [aliceKey.address()],
      extAmount: 100n * E18,
    });
    await nvda.connect(alice).approve(poolAddr, 100n * E18);
    await expect(pool.connect(alice).transact(tx.args, tx.extSol)).to.emit(pool, 'Shielded');
    expect(await nvda.balanceOf(poolAddr)).to.equal(100n * E18);

    await client.sync();
    expect(client.tree.size).to.equal(2);
    expect(await pool.getLastRoot()).to.equal(core.toHex32(client.tree.root));
    expect(client.balance(aliceKey, nvdaId)).to.equal(100n * E18);
    expect(client.balance(bobKey, nvdaId)).to.equal(0n);

    // -- private transfer 30 NVDA to bob, 70 change to alice
    const [input] = client.notes(aliceKey);
    const toBob = core.createNote(nvdaId, 30n * E18, bobKey.pk);
    const change = core.createNote(nvdaId, 70n * E18, aliceKey.pk);
    tx = await buildTransact(client, {
      key: aliceKey,
      asset: nvdaAddr,
      inputs: [input],
      outputs: [toBob, change],
      outputRecipients: [bobKey.address(), aliceKey.address()],
      extAmount: 0n,
    });
    // Anyone can submit: the relayer pays gas and learns nothing but the asset.
    await expect(pool.connect(relayer).transact(tx.args, tx.extSol)).to.emit(pool, 'NewNullifier');
    await client.sync();
    expect(client.balance(aliceKey, nvdaId)).to.equal(70n * E18);
    expect(client.balance(bobKey, nvdaId)).to.equal(30n * E18);
    expect(await nvda.balanceOf(poolAddr)).to.equal(100n * E18);

    // -- replaying the same proof must fail on the spent nullifier
    await expect(pool.connect(relayer).transact(tx.args, tx.extSol)).to.be.revertedWithCustomError(pool, 'NullifierSpent');

    // -- bob unshields 30 NVDA to his EOA through the relayer, paying 1 NVDA fee
    const [bobNote] = client.notes(bobKey);
    const bobAddr = await bob.getAddress();
    const relayerAddr = await relayer.getAddress();
    tx = await buildTransact(client, {
      key: bobKey,
      asset: nvdaAddr,
      inputs: [bobNote],
      outputs: [],
      outputRecipients: [],
      extAmount: -(29n * E18),
      recipient: bobAddr,
      relayer: relayerAddr,
      fee: 1n * E18,
    });
    await expect(pool.connect(relayer).transact(tx.args, tx.extSol)).to.emit(pool, 'Unshielded');
    expect(await nvda.balanceOf(bobAddr)).to.equal(29n * E18);
    expect(await nvda.balanceOf(relayerAddr)).to.equal(1n * E18);
    expect(await nvda.balanceOf(poolAddr)).to.equal(70n * E18);
    await client.sync();
    expect(client.balance(bobKey, nvdaId)).to.equal(0n);

    // -- a full viewing key sees the same notes but cannot spend
    const view = core.decodeViewingKey(core.encodeViewingKey(aliceKey.viewingKey()));
    const viewed = core.scanCommitments(view, client.commitments).filter((n) => !client.spent.has(n.nullifier) && n.amount > 0n);
    expect(viewed.reduce((a, n) => a + n.amount, 0n)).to.equal(70n * E18);

    // -- shielded address round trip
    const encoded = core.encodeAddress(bobKey.address());
    expect(encoded.startsWith('elysian1')).to.equal(true);
    expect(core.decodeAddress(encoded).pk).to.equal(bobKey.pk);
  });

  it('refuses to unshield to a blocklisted address', async () => {
    const env = await deployAll();
    const { pool, nvda, alice, bob } = env;
    const client = new Client(env);
    const key = core.SpendingKey.random();
    const nvdaAddr = await nvda.getAddress();
    const nvdaId = core.assetToId(nvdaAddr);

    await client.sync();
    let tx = await buildTransact(client, {
      key,
      asset: nvdaAddr,
      inputs: [],
      outputs: [core.createNote(nvdaId, 10n * E18, key.pk)],
      outputRecipients: [key.address()],
      extAmount: 10n * E18,
    });
    await nvda.connect(alice).approve(await pool.getAddress(), 10n * E18);
    await pool.connect(alice).transact(tx.args, tx.extSol);
    await client.sync();

    const bobAddr = await bob.getAddress();
    await nvda.setBlocked(bobAddr, true);
    const [note] = client.notes(key);
    tx = await buildTransact(client, {
      key,
      asset: nvdaAddr,
      inputs: [note],
      outputs: [],
      outputRecipients: [],
      extAmount: -(10n * E18),
      recipient: bobAddr,
    });
    await expect(pool.connect(alice).transact(tx.args, tx.extSol)).to.be.revertedWithCustomError(nvda, 'Blocked');
  });

  it('sealed batch swap: intent, execution, claim, unshield', async () => {
    const env = await deployAll();
    const { pool, swap, dex, nvda, usdg, alice, bob, executor } = env;
    const client = new Client(env);
    const key = core.SpendingKey.random();
    const nvdaAddr = await nvda.getAddress();
    const usdgAddr = await usdg.getAddress();
    const nvdaId = core.assetToId(nvdaAddr);
    const usdgId = core.assetToId(usdgAddr);
    const poolAddr = await pool.getAddress();
    const swapAddr = await swap.getAddress();

    // shield 100 NVDA
    await client.sync();
    let tx = await buildTransact(client, {
      key,
      asset: nvdaAddr,
      inputs: [],
      outputs: [core.createNote(nvdaId, 100n * E18, key.pk)],
      outputRecipients: [key.address()],
      extAmount: 100n * E18,
    });
    await nvda.connect(alice).approve(poolAddr, 100n * E18);
    await pool.connect(alice).transact(tx.args, tx.extSol);
    await client.sync();

    // swap intent: 10 NVDA -> USDG. Pin the chain to the start of a fresh batch so the
    // proof time cannot straddle a batch boundary.
    const latest = await ethers.provider.getBlock('latest');
    const batchStart = (Math.floor(latest!.timestamp / Number(BATCH)) + 1) * Number(BATCH);
    await network.provider.send('evm_setNextBlockTimestamp', [batchStart]);
    await network.provider.send('evm_mine');
    const batchId: bigint = await swap.currentBatch();
    expect(batchId).to.equal(BigInt(batchStart / Number(BATCH)));
    const intent: Core.SwapIntent = {
      batchId,
      assetIn: nvdaId,
      assetOut: usdgId,
      amountIn: 10n * E18,
      pk: key.pk,
      blinding: core.randomField(),
    };
    const commitment = core.swapCommitment(intent);
    const ciphertext = core.encryptTo(key.encPub, core.serializeSwap(intent));
    const [input] = client.notes(key);
    tx = await buildTransact(client, {
      key,
      asset: nvdaAddr,
      inputs: [input],
      outputs: [core.createNote(nvdaId, 90n * E18, key.pk)],
      outputRecipients: [key.address()],
      extAmount: -(10n * E18),
      recipient: swapAddr,
      adapterData: core.encodeSwapAdapterData(usdgAddr as `0x${string}`, core.swapOwnerTag(intent), batchId, ciphertext),
    });
    await expect(pool.connect(alice).transact(tx.args, tx.extSol)).to.emit(swap, 'SwapIntent');
    expect(await nvda.balanceOf(swapAddr)).to.equal(10n * E18);
    const batchBefore = await swap.getBatch(nvdaAddr, usdgAddr, batchId);
    expect(batchBefore.totalIn).to.equal(10n * E18);

    // cannot execute an open batch
    await expect(swap.connect(executor).executeBatch(nvdaAddr, usdgAddr, batchId, 0)).to.be.revertedWithCustomError(swap, 'BatchNotClosed');

    // close the batch and clear it
    await network.provider.send('evm_increaseTime', [Number(BATCH) + 1]);
    await network.provider.send('evm_mine');
    const expectedOut: bigint = await dex.quote(nvdaAddr, usdgAddr, 10n * E18);
    await expect(swap.connect(executor).executeBatch(nvdaAddr, usdgAddr, batchId, expectedOut)).to.emit(swap, 'BatchExecuted');
    const batch = await swap.getBatch(nvdaAddr, usdgAddr, batchId);
    expect(batch.executed).to.equal(true);
    expect(batch.totalOut).to.equal(expectedOut);
    expect(await usdg.balanceOf(poolAddr)).to.equal(expectedOut);

    // claim: scan the swap log, prove, mint USDG note
    await client.sync();
    const [owned] = core.scanSwaps(key, client.swaps);
    expect(owned.amountIn).to.equal(10n * E18);
    const witness = core.buildSwapClaimWitness({ key, domain: await domainOf(swap), encPub: key.encPub,
      swap: owned,
      path: client.swapTree.path(owned.leafIndex),
      totalIn: batch.totalIn,
      totalOut: batch.totalOut,
      outBlinding: core.randomField(),
    });
    const { proof } = await prove('swapClaim', witness.circuitInputs);
    const claimArgs = {
      proof: core.encodeProof(proof),
      swapRoot: core.toHex32(witness.swapRoot),
      batchId,
      assetIn: nvdaAddr,
      assetOut: usdgAddr,
      nullifier: core.toHex32(witness.nullifier),
      outputCommitment: core.toHex32(witness.outputCommitment),
      encryptedOutput: hex(witness.encryptedOutput),
    };
    await expect(swap.connect(bob).claim(claimArgs)).to.emit(pool, 'NewCommitment');
    await expect(swap.connect(bob).claim(claimArgs)).to.be.revertedWithCustomError(swap, 'SwapAlreadyClaimed');

    await client.sync();
    expect(client.balance(key, usdgId)).to.equal(expectedOut);
    expect(client.balance(key, nvdaId)).to.equal(90n * E18);

    // unshield the USDG to bob
    const [usdgNote] = client.notes(key).filter((n) => n.asset === usdgId);
    const bobAddr = await bob.getAddress();
    tx = await buildTransact(client, {
      key,
      asset: usdgAddr,
      inputs: [usdgNote],
      outputs: [],
      outputRecipients: [],
      extAmount: -usdgNote.amount,
      recipient: bobAddr,
    });
    await pool.connect(bob).transact(tx.args, tx.extSol);
    expect(await usdg.balanceOf(bobAddr)).to.equal(expectedOut);
  });
});

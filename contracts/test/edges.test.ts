/**
 * Every failure path and every less-common success path, with real proofs where a proof is involved.
 */
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import type { Contract, Signer } from 'ethers';
import { deployHasher, hex, loadCore, prove, unhex, type CoreModule, domainOf } from './helpers';

const LEVELS = 20;
const BATCH = 60n;
const E18 = 10n ** 18n;
let core: CoreModule;

describe('Elysian · edge cases', function () {
  before(async () => {
    core = await loadCore();
  });

  interface Env {
    deployer: Signer;
    alice: Signer;
    bob: Signer;
    carol: Signer;
    relayer: Signer;
    executor: Signer;
    pool: Contract;
    swap: Contract;
    dex: Contract;
    nvda: Contract;
    usdg: Contract;
    hasher: Contract;
  }

  async function deployAll(): Promise<Env> {
    const [deployer, alice, bob, carol, relayer, executor] = await ethers.getSigners();
    const hasher = await deployHasher(deployer);
    const txVerifier = await (await ethers.getContractFactory('TransactionVerifier')).deploy();
    const claimVerifier = await (await ethers.getContractFactory('SwapClaimVerifier')).deploy();
    const pool = await (await ethers.getContractFactory('ElysianPool')).deploy(await txVerifier.getAddress(), await hasher.getAddress(), LEVELS, await deployer.getAddress());
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
    for (const s of [alice, bob, carol]) {
      await nvda.mint(await s.getAddress(), 1_000n * E18);
      await usdg.mint(await s.getAddress(), 1_000_000n * E18);
    }
    await nvda.mint(await dex.getAddress(), 10_000n * E18);
    await usdg.mint(await dex.getAddress(), 1_800_000n * E18);
    return { deployer, alice, bob, carol, relayer, executor, pool, swap, dex, nvda, usdg, hasher } as unknown as Env;
  }

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
      for (const ev of await pool.queryFilter(pool.filters.NewCommitment())) {
        const [commitment, index, ciphertext] = (ev as any).args as [string, bigint, string];
        if (Number(index) < this.tree.size) continue;
        this.tree.insert(BigInt(commitment));
        this.commitments.push({ commitment: BigInt(commitment), index: Number(index), ciphertext: unhex(ciphertext) });
      }
      for (const ev of await pool.queryFilter(pool.filters.NewNullifier())) this.spent.add(BigInt((ev as any).args[0]));
      for (const ev of await swap.queryFilter(swap.filters.SwapIntent())) {
        const [commitment, index, batchId, assetIn, assetOut, amountIn, ciphertext] = (ev as any).args;
        if (Number(index) < this.swapTree.size) continue;
        this.swapTree.insert(BigInt(commitment));
        this.swaps.push({ commitment: BigInt(commitment), index: Number(index), batchId: BigInt(batchId), assetIn: BigInt(assetIn), assetOut: BigInt(assetOut), amountIn: BigInt(amountIn), ciphertext: unhex(ciphertext) });
      }
    }
    notes(key: Core.SpendingKey, asset?: bigint) {
      return core.scanCommitments(key, this.commitments).filter((n) => !this.spent.has(n.nullifier) && n.amount > 0n && (asset === undefined || n.asset === asset));
    }
    balance(key: Core.SpendingKey, asset: bigint) {
      return this.notes(key, asset).reduce((a, n) => a + n.amount, 0n);
    }
  }

  const ZERO = '0x0000000000000000000000000000000000000000';

  interface TxParams {
    key: Core.SpendingKey;
    asset: string;
    inputs: Core.OwnedNote[];
    outputs: { note: Core.Note; to: Core.ShieldedAddress }[];
    extAmount: bigint;
    recipient?: string;
    relayer?: string;
    fee?: bigint;
    adapterData?: Uint8Array;
    rootOverride?: bigint;
  }

  async function build(client: Client, p: TxParams) {
    const assetId = core.assetToId(p.asset);
    const outputs = [...p.outputs];
    while (outputs.length < 2) outputs.push({ note: core.dummyNote(assetId, p.key.pk), to: p.key.address() });
    const ext: Core.ExtData = {
      recipient: (p.recipient ?? ZERO) as `0x${string}`,
      extAmount: p.extAmount,
      relayer: (p.relayer ?? ZERO) as `0x${string}`,
      fee: p.fee ?? 0n,
      encryptedOutput1: core.encryptTo(outputs[0].to.encPub, core.serializeNote(outputs[0].note)),
      encryptedOutput2: core.encryptTo(outputs[1].to.encPub, core.serializeNote(outputs[1].note)),
      adapterData: p.adapterData ?? new Uint8Array(),
    };
    const edh = core.extDataHash(ext, await domainOf(client.env.pool));
    const witness = core.buildTransactionWitness({
      key: p.key,
      assetId,
      inputs: p.inputs.map((n) => ({ note: n, leafIndex: n.leafIndex, path: client.tree.path(n.leafIndex) })),
      outputs: outputs.map((o) => o.note),
      publicAmount: core.publicAmount(ext.extAmount, ext.fee),
      extDataHash: edh,
      tree: client.tree,
    });
    const { proof } = await prove('transaction', witness.circuitInputs);
    const args = {
      proof: core.encodeProof(proof),
      root: core.toHex32(p.rootOverride ?? witness.root),
      inputNullifiers: witness.inputNullifiers.map(core.toHex32),
      outputCommitments: witness.outputCommitments.map(core.toHex32),
      publicAmount: core.publicAmount(ext.extAmount, ext.fee),
      assetId,
      extDataHash: core.toHex32(edh),
    };
    const extSol = { ...ext, encryptedOutput1: hex(ext.encryptedOutput1), encryptedOutput2: hex(ext.encryptedOutput2), adapterData: hex(ext.adapterData) };
    return { args, ext, extSol };
  }

  async function shield(env: Env, client: Client, key: Core.SpendingKey, token: Contract, from: Signer, amount: bigint) {
    const addr = await token.getAddress();
    await client.sync();
    const tx = await build(client, { key, asset: addr, inputs: [], outputs: [{ note: core.createNote(addr, amount, key.pk), to: key.address() }], extAmount: amount });
    await token.connect(from).approve(await env.pool.getAddress(), amount);
    await env.pool.connect(from).transact(tx.args, tx.extSol);
    await client.sync();
  }

  async function nextBatch(swap: Contract): Promise<bigint> {
    const latest = await ethers.provider.getBlock('latest');
    const start = (Math.floor(latest!.timestamp / Number(BATCH)) + 1) * Number(BATCH);
    await network.provider.send('evm_setNextBlockTimestamp', [start]);
    await network.provider.send('evm_mine');
    return swap.currentBatch();
  }

  async function closeBatch() {
    await network.provider.send('evm_increaseTime', [Number(BATCH) + 1]);
    await network.provider.send('evm_mine');
  }

  /* ---------------------------------- pool ---------------------------------- */

  it('spends two notes at once and pays change on a partial unshield', async () => {
    const env = await deployAll();
    const { pool, nvda, alice, bob } = env;
    const client = new Client(env);
    const key = core.SpendingKey.random();
    const nvdaAddr = await nvda.getAddress();
    const id = core.assetToId(nvdaAddr);
    await shield(env, client, key, nvda, alice, 40n * E18);
    await shield(env, client, key, nvda, alice, 25n * E18);
    expect(client.notes(key, id).length).to.equal(2);

    const inputs = core.selectNotes(client.notes(key, id), 50n * E18);
    expect(inputs.length).to.equal(2);
    const bobAddr = await bob.getAddress();
    const tx = await build(client, {
      key,
      asset: nvdaAddr,
      inputs,
      outputs: [{ note: core.createNote(nvdaAddr, 15n * E18, key.pk), to: key.address() }],
      extAmount: -(50n * E18),
      recipient: bobAddr,
    });
    await pool.connect(alice).transact(tx.args, tx.extSol);
    expect(await nvda.balanceOf(bobAddr)).to.equal(1_050n * E18);
    await client.sync();
    expect(client.balance(key, id)).to.equal(15n * E18);
    expect(client.notes(key, id).length).to.equal(1);
  });

  it('keeps several assets apart in one key', async () => {
    const env = await deployAll();
    const { nvda, usdg, alice } = env;
    const client = new Client(env);
    const key = core.SpendingKey.random();
    await shield(env, client, key, nvda, alice, 3n * E18);
    await shield(env, client, key, usdg, alice, 900n * E18);
    expect(client.balance(key, core.assetToId(await nvda.getAddress()))).to.equal(3n * E18);
    expect(client.balance(key, core.assetToId(await usdg.getAddress()))).to.equal(900n * E18);
    const byAsset = core.balances(core.scanCommitments(key, client.commitments), client.spent);
    expect(byAsset.length).to.equal(2);
  });

  it('rejects a tampered proof, a stale root, a wrong extData hash and a bad public amount', async () => {
    const env = await deployAll();
    const { pool, nvda, alice, bob } = env;
    const client = new Client(env);
    const key = core.SpendingKey.random();
    const nvdaAddr = await nvda.getAddress();
    await shield(env, client, key, nvda, alice, 10n * E18);
    const [note] = client.notes(key);
    const bobAddr = await bob.getAddress();
    const good = await build(client, { key, asset: nvdaAddr, inputs: [note], outputs: [], extAmount: -(10n * E18), recipient: bobAddr });

    // A transaction hashed for another chain is refused: the chain id and pool address are in the hash.
    const foreign = core.extDataHash({ ...good.ext }, { chainId: 4663, contract: (await pool.getAddress()) as `0x${string}` });
    await expect(pool.transact({ ...good.args, extDataHash: core.toHex32(foreign) }, good.extSol)).to.be.revertedWithCustomError(pool, 'InvalidExtDataHash');

    // Relayer swaps the recipient: hash no longer matches.
    await expect(pool.transact(good.args, { ...good.extSol, recipient: await alice.getAddress() })).to.be.revertedWithCustomError(pool, 'InvalidExtDataHash');
    // Public amount that disagrees with extData.
    await expect(pool.transact({ ...good.args, publicAmount: 1n }, good.extSol)).to.be.revertedWithCustomError(pool, 'InvalidPublicAmount');
    // A root the pool has never had.
    await expect(pool.transact({ ...good.args, root: core.toHex32(12345n) }, good.extSol)).to.be.revertedWithCustomError(pool, 'UnknownRoot');
    // Proof bytes flipped.
    const bad = '0x' + (good.args.proof.slice(2, 4) === 'ff' ? '00' : 'ff') + good.args.proof.slice(4);
    await expect(pool.transact({ ...good.args, proof: bad }, good.extSol)).to.be.reverted;
    // A different output commitment than the one proven.
    await expect(pool.transact({ ...good.args, outputCommitments: [core.toHex32(7n), good.args.outputCommitments[1]] }, good.extSol)).to.be.revertedWithCustomError(pool, 'InvalidProof');
    // The untouched transaction still works afterwards.
    await pool.transact(good.args, good.extSol);
    expect(await nvda.balanceOf(bobAddr)).to.equal(1_010n * E18);
  });

  it('bounds fees and amounts, refuses asset id zero, and gates adapter inserts', async () => {
    const env = await deployAll();
    const { pool, bob } = env;
    await expect(pool.calculatePublicAmount(0n, 2n ** 120n)).to.be.revertedWithCustomError(pool, 'FeeOutOfRange');
    await expect(pool.calculatePublicAmount(2n ** 120n, 0n)).to.be.revertedWithCustomError(pool, 'AmountOutOfRange');
    await expect(pool.calculatePublicAmount(-(2n ** 120n), 0n)).to.be.revertedWithCustomError(pool, 'AmountOutOfRange');
    expect(await pool.calculatePublicAmount(-5n, 2n)).to.equal(core.FIELD_SIZE - 7n);
    expect(await pool.calculatePublicAmount(9n, 4n)).to.equal(5n);
    const args = {
      proof: '0x' + '00'.repeat(256),
      root: await pool.getLastRoot(),
      inputNullifiers: [core.toHex32(1n), core.toHex32(2n)],
      outputCommitments: [core.toHex32(3n), core.toHex32(4n)],
      publicAmount: 0n,
      assetId: 0n,
      extDataHash: core.toHex32(0n),
    };
    const ext = { recipient: ZERO, extAmount: 0n, relayer: ZERO, fee: 0n, encryptedOutput1: '0x', encryptedOutput2: '0x', adapterData: '0x' };
    await expect(pool.transact(args, ext)).to.be.revertedWithCustomError(pool, 'InvalidAsset');
    await expect(pool.connect(bob).insertFromAdapter(core.toHex32(5n), '0x')).to.be.revertedWithCustomError(pool, 'NotAdapter');
    await expect(pool.connect(bob).setAdapter(await bob.getAddress(), true)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });

  it('forgets roots older than the history window', async () => {
    const env = await deployAll();
    const tree = await (await ethers.getContractFactory('MerkleTreeHarness')).deploy(LEVELS, await env.hasher.getAddress());
    const mirror = new core.MerkleTree(LEVELS);
    const first = await tree.getLastRoot();
    expect(first).to.equal(core.toHex32(mirror.root));
    for (let i = 1; i <= 101; i++) {
      await tree.insert(core.toHex32(BigInt(i)));
      mirror.insert(BigInt(i));
      if (i === 50) expect(await tree.isKnownRoot(first)).to.equal(true);
    }
    expect(await tree.getLastRoot()).to.equal(core.toHex32(mirror.root));
    expect(await tree.isKnownRoot(first)).to.equal(false);
    expect(await tree.isKnownRoot(core.toHex32(0n))).to.equal(false);
  });

  it('lets a viewing key see spends without being able to spend', async () => {
    const env = await deployAll();
    const { pool, nvda, alice, bob } = env;
    const client = new Client(env);
    const key = core.SpendingKey.random();
    const nvdaAddr = await nvda.getAddress();
    await shield(env, client, key, nvda, alice, 8n * E18);
    const view = core.decodeViewingKey(core.encodeViewingKey(key.viewingKey()));
    let seen = core.scanCommitments(view, client.commitments).filter((n) => n.amount > 0n);
    expect(seen.length).to.equal(1);
    expect(client.spent.has(seen[0].nullifier)).to.equal(false);

    const [note] = client.notes(key);
    const tx = await build(client, { key, asset: nvdaAddr, inputs: [note], outputs: [], extAmount: -(8n * E18), recipient: await bob.getAddress() });
    await pool.transact(tx.args, tx.extSol);
    await client.sync();
    seen = core.scanCommitments(view, client.commitments).filter((n) => n.amount > 0n);
    expect(client.spent.has(seen[0].nullifier)).to.equal(true);
    expect(core.pkFromViewingKey(view)).to.equal(key.pk);
    expect(() => new core.SpendingKey(view.nk)).to.not.throw();
    expect(new core.SpendingKey(view.nk).pk).to.not.equal(key.pk);
  });

  /* ---------------------------------- swaps ---------------------------------- */

  it('shares one clearing price across two users and clears the reverse direction separately', async () => {
    const env = await deployAll();
    const { pool, swap, dex, nvda, usdg, alice, bob, executor } = env;
    const client = new Client(env);
    const ka = core.SpendingKey.random();
    const kb = core.SpendingKey.random();
    const nvdaAddr = await nvda.getAddress();
    const usdgAddr = await usdg.getAddress();
    const nvdaId = core.assetToId(nvdaAddr);
    const usdgId = core.assetToId(usdgAddr);
    await shield(env, client, ka, nvda, alice, 30n * E18);
    await shield(env, client, kb, nvda, bob, 30n * E18);
    await shield(env, client, kb, usdg, bob, 5_000n * E18);

    const batchId = await nextBatch(swap);
    const intent = async (key: Core.SpendingKey, assetIn: string, assetOut: string, amountIn: bigint, from: Signer) => {
      const s: Core.SwapIntent = { batchId, assetIn: core.assetToId(assetIn), assetOut: core.assetToId(assetOut), amountIn, pk: key.pk, blinding: core.randomField() };
      const [input] = client.notes(key, core.assetToId(assetIn));
      const tx = await build(client, {
        key,
        asset: assetIn,
        inputs: [input],
        outputs: [{ note: core.createNote(assetIn, input.amount - amountIn, key.pk), to: key.address() }],
        extAmount: -amountIn,
        recipient: await swap.getAddress(),
        adapterData: core.encodeSwapAdapterData(assetOut as `0x${string}`, core.swapOwnerTag(s), batchId, core.encryptTo(key.encPub, core.serializeSwap(s))),
      });
      await pool.connect(from).transact(tx.args, tx.extSol);
      await client.sync();
      return s;
    };
    await intent(ka, nvdaAddr, usdgAddr, 10n * E18, alice);
    await intent(kb, nvdaAddr, usdgAddr, 20n * E18, bob);
    await intent(kb, usdgAddr, nvdaAddr, 1_000n * E18, bob);

    const forward = await swap.getBatch(nvdaAddr, usdgAddr, batchId);
    const back = await swap.getBatch(usdgAddr, nvdaAddr, batchId);
    expect(forward.totalIn).to.equal(30n * E18);
    expect(back.totalIn).to.equal(1_000n * E18);

    await closeBatch();
    const q = await dex.quote(nvdaAddr, usdgAddr, 30n * E18);
    await swap.connect(executor).executeBatch(nvdaAddr, usdgAddr, batchId, q);
    await swap.connect(executor).executeBatch(usdgAddr, nvdaAddr, batchId, 0);
    const f = await swap.getBatch(nvdaAddr, usdgAddr, batchId);
    const b = await swap.getBatch(usdgAddr, nvdaAddr, batchId);
    expect(f.executed && b.executed).to.equal(true);

    // Claims: both forward users get the same price, floor-rounded; sum never exceeds totalOut.
    const claim = async (key: Core.SpendingKey, assetIn: string, assetOut: string, batch: { totalIn: bigint; totalOut: bigint }) => {
      await client.sync();
      const owned = core.scanSwaps(key, client.swaps).find((s) => s.assetIn === core.assetToId(assetIn) && s.assetOut === core.assetToId(assetOut))!;
      const w = core.buildSwapClaimWitness({ key, domain: await domainOf(swap), encPub: key.encPub, swap: owned, path: client.swapTree.path(owned.leafIndex), totalIn: batch.totalIn, totalOut: batch.totalOut, outBlinding: core.randomField() });
      const { proof } = await prove('swapClaim', w.circuitInputs);
      await swap.claim({
        proof: core.encodeProof(proof),
        swapRoot: core.toHex32(w.swapRoot),
        batchId,
        assetIn,
        assetOut,
        nullifier: core.toHex32(w.nullifier),
        outputCommitment: core.toHex32(w.outputCommitment),
        encryptedOutput: hex(w.encryptedOutput),
      });
      return w.output.amount;
    };
    const outA = await claim(ka, nvdaAddr, usdgAddr, f);
    const outB = await claim(kb, nvdaAddr, usdgAddr, f);
    const outB2 = await claim(kb, usdgAddr, nvdaAddr, b);
    expect(outA).to.equal((10n * E18 * f.totalOut) / f.totalIn);
    expect(outB).to.equal((20n * E18 * f.totalOut) / f.totalIn);
    expect(outA + outB <= f.totalOut).to.equal(true);
    expect(outB2).to.equal(b.totalOut);
    await client.sync();
    expect(client.balance(ka, usdgId)).to.equal(outA);
    expect(client.balance(kb, usdgId)).to.equal(4_000n * E18 + outB);
    expect(client.balance(kb, nvdaId)).to.equal(10n * E18 + outB2);
  });

  it('enforces batch rules: same asset, stale batch, empty batch, executor gate, grace period, unexecuted claim', async () => {
    const env = await deployAll();
    const { pool, swap, nvda, usdg, alice, bob, executor } = env;
    const client = new Client(env);
    const key = core.SpendingKey.random();
    const nvdaAddr = await nvda.getAddress();
    const usdgAddr = await usdg.getAddress();
    await shield(env, client, key, nvda, alice, 50n * E18);
    const batchId = await nextBatch(swap);

    const intentTx = async (assetOut: string, bId: bigint, amountIn = 5n * E18) => {
      const s: Core.SwapIntent = { batchId: bId, assetIn: core.assetToId(nvdaAddr), assetOut: core.assetToId(assetOut), amountIn, pk: key.pk, blinding: core.randomField() };
      const [input] = client.notes(key, core.assetToId(nvdaAddr));
      return build(client, {
        key,
        asset: nvdaAddr,
        inputs: [input],
        outputs: [{ note: core.createNote(nvdaAddr, input.amount - amountIn, key.pk), to: key.address() }],
        extAmount: -amountIn,
        recipient: await swap.getAddress(),
        adapterData: core.encodeSwapAdapterData(assetOut as `0x${string}`, core.swapOwnerTag(s), bId, core.encryptTo(key.encPub, core.serializeSwap(s))),
      });
    };

    let tx = await intentTx(nvdaAddr, batchId);
    await expect(pool.connect(alice).transact(tx.args, tx.extSol)).to.be.revertedWithCustomError(swap, 'SameAsset');
    tx = await intentTx(usdgAddr, batchId - 1n);
    await expect(pool.connect(alice).transact(tx.args, tx.extSol)).to.be.revertedWithCustomError(swap, 'BadBatch');
    tx = await intentTx(usdgAddr, batchId + 2n);
    await expect(pool.connect(alice).transact(tx.args, tx.extSol)).to.be.revertedWithCustomError(swap, 'BadBatch');
    // Next batch is allowed (submitting near a boundary).
    tx = await intentTx(usdgAddr, batchId + 1n);
    await pool.connect(alice).transact(tx.args, tx.extSol);
    await client.sync();

    await closeBatch();
    // batchId itself is closed but empty; batchId+1 holds the intent and is now closed too after another step.
    await expect(swap.connect(executor).executeBatch(nvdaAddr, usdgAddr, batchId, 0)).to.be.revertedWithCustomError(swap, 'BatchEmpty');
    await expect(swap.connect(executor).executeBatch(nvdaAddr, usdgAddr, batchId + 1n, 0)).to.be.revertedWithCustomError(swap, 'BatchNotClosed');
    await closeBatch();
    // A stranger cannot execute inside the grace period.
    await expect(swap.connect(bob).executeBatch(nvdaAddr, usdgAddr, batchId + 1n, 0)).to.be.revertedWithCustomError(swap, 'NotExecutor');
    // A claim before execution is refused.
    await client.sync();
    const owned = core.scanSwaps(key, client.swaps)[0];
    const w = core.buildSwapClaimWitness({ key, domain: await domainOf(swap), encPub: key.encPub, swap: owned, path: client.swapTree.path(owned.leafIndex), totalIn: 5n * E18, totalOut: 1n, outBlinding: core.randomField() });
    const { proof } = await prove('swapClaim', w.circuitInputs);
    const claimArgs = {
      proof: core.encodeProof(proof),
      swapRoot: core.toHex32(w.swapRoot),
      batchId: batchId + 1n,
      assetIn: nvdaAddr,
      assetOut: usdgAddr,
      nullifier: core.toHex32(w.nullifier),
      outputCommitment: core.toHex32(w.outputCommitment),
      encryptedOutput: hex(w.encryptedOutput),
    };
    await expect(swap.claim(claimArgs)).to.be.revertedWithCustomError(swap, 'BatchNotExecuted');
    // An order cannot claim to be bigger than what it actually moved: the leaf is built on-chain from the real amount.
    const inflated = core.buildSwapClaimWitness({ key, domain: await domainOf(swap), encPub: key.encPub, swap: { ...owned, amountIn: owned.amountIn * 100n }, path: client.swapTree.path(owned.leafIndex), totalIn: 5n * E18, totalOut: 5n * E18, outBlinding: core.randomField() });
    let forged = false;
    try {
      await prove('swapClaim', inflated.circuitInputs);
      forged = true;
    } catch {
      /* the circuit refuses: no such leaf exists */
    }
    expect(forged).to.equal(false);

    // After the grace period a stranger still cannot execute (they would choose the slippage), but anyone can cancel.
    await network.provider.send('evm_increaseTime', [3601]);
    await network.provider.send('evm_mine');
    await expect(swap.connect(bob).executeBatch(nvdaAddr, usdgAddr, batchId + 1n, 0)).to.be.revertedWithCustomError(swap, 'NotExecutor');
    const nvdaId = core.assetToId(nvdaAddr);
    const heldBefore: bigint = await nvda.balanceOf(await pool.getAddress());
    await expect(swap.connect(bob).cancelBatch(nvdaAddr, usdgAddr, batchId + 1n)).to.emit(swap, 'BatchCancelled');
    expect((await nvda.balanceOf(await pool.getAddress())) - heldBefore).to.equal(5n * E18);
    await expect(swap.connect(executor).executeBatch(nvdaAddr, usdgAddr, batchId + 1n, 0)).to.be.revertedWithCustomError(swap, 'BatchAlreadyExecuted');
    await expect(swap.connect(bob).cancelBatch(nvdaAddr, usdgAddr, batchId + 1n)).to.be.revertedWithCustomError(swap, 'BatchAlreadyExecuted');
    // The proof above was made against fabricated totals, so it does not verify.
    await expect(swap.claim(claimArgs)).to.be.revertedWithCustomError(swap, 'InvalidClaimProof');

    // A relayer that swaps the ciphertext for its own bytes, or for nothing, cannot use the proof.
    const r0 = core.buildSwapClaimWitness({ key, domain: await domainOf(swap), encPub: key.encPub, swap: owned, path: client.swapTree.path(owned.leafIndex), totalIn: 5n * E18, totalOut: 5n * E18, outBlinding: core.randomField(), refunded: true });
    const p0 = await prove('swapClaim', r0.circuitInputs);
    const good = { ...claimArgs, proof: core.encodeProof(p0.proof), nullifier: core.toHex32(r0.nullifier), outputCommitment: core.toHex32(r0.outputCommitment), encryptedOutput: hex(r0.encryptedOutput) };
    const tampered = Buffer.from(r0.encryptedOutput);
    tampered[tampered.length - 1] ^= 1;
    await expect(swap.connect(bob).claim({ ...good, encryptedOutput: hex(new Uint8Array(tampered)) })).to.be.revertedWithCustomError(swap, 'InvalidClaimProof');
    await expect(swap.connect(bob).claim({ ...good, encryptedOutput: '0x' })).to.be.revertedWithCustomError(swap, 'InvalidClaimProof');
    // A proof made for another chain or another swap contract is refused here.
    const elsewhere = core.buildSwapClaimWitness({ key, domain: { chainId: 4663, contract: await swap.getAddress() as `0x${string}` }, encPub: key.encPub, swap: owned, path: client.swapTree.path(owned.leafIndex), totalIn: 5n * E18, totalOut: 5n * E18, outBlinding: core.randomField(), refunded: true });
    const pe = await prove('swapClaim', elsewhere.circuitInputs);
    await expect(swap.connect(bob).claim({ ...good, proof: core.encodeProof(pe.proof), nullifier: core.toHex32(elsewhere.nullifier), outputCommitment: core.toHex32(elsewhere.outputCommitment), encryptedOutput: hex(elsewhere.encryptedOutput) })).to.be.revertedWithCustomError(swap, 'InvalidClaimProof');

    // The refund: the order comes back as a note of the asset it sold, one for one.
    const before = client.balance(key, nvdaId);
    const r = core.buildSwapClaimWitness({ key, domain: await domainOf(swap), encPub: key.encPub, swap: owned, path: client.swapTree.path(owned.leafIndex), totalIn: 5n * E18, totalOut: 5n * E18, outBlinding: core.randomField(), refunded: true });
    const refundProof = await prove('swapClaim', r.circuitInputs);
    await swap.connect(bob).claim({ ...claimArgs, proof: core.encodeProof(refundProof.proof), nullifier: core.toHex32(r.nullifier), outputCommitment: core.toHex32(r.outputCommitment), encryptedOutput: hex(r.encryptedOutput) });
    await client.sync();
    expect(client.balance(key, nvdaId) - before).to.equal(5n * E18);

    // Once the pool holds deposits, a new adapter (which could mint notes) has to wait two days in the open.
    await expect(pool.setAdapter(await bob.getAddress(), true)).to.be.revertedWithCustomError(pool, 'AdapterNotReady');
    await pool.proposeAdapter(await bob.getAddress());
    await expect(pool.setAdapter(await bob.getAddress(), true)).to.be.revertedWithCustomError(pool, 'AdapterNotReady');
    await network.provider.send('evm_increaseTime', [2 * 86400 + 1]);
    await network.provider.send('evm_mine');
    await pool.setAdapter(await bob.getAddress(), true);
    await pool.setAdapter(await bob.getAddress(), false);
    await expect(swap.setDex()).to.be.revertedWithCustomError(swap, 'DexNotReady');
    // Only the pool may deliver intents.
    await expect(swap.connect(bob).onShieldedTransfer(nvdaAddr, 1n, '0x')).to.be.revertedWithCustomError(swap, 'OnlyPool');
  });
});

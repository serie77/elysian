/**
 * End-to-end smoke test against a running local stack (node scripts/dev.mjs):
 * shield -> relayed private transfer -> relayed unshield -> swap intent -> batch clears -> relayed claim.
 * Talks to the chain with viem and to the Elysian node over HTTP exactly like the web wallet does.
 *
 *   npx tsx node/scripts/smoke.ts
 */
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import * as snarkjs from 'snarkjs';
import fs from 'node:fs';
import path from 'node:path';
import {
  MerkleTree,
  SpendingKey,
  encodeViewingKey,
  TREE_LEVELS,
  ZERO_ADDRESS,
  assetToId,
  buildSwapClaimWitness,
  buildTransactionWitness,
  createNote,
  dummyNote,
  encodeProof,
  encodeSwapAdapterData,
  encryptTo,
  extDataHash,
  hexToBytes,
  publicAmount,
  randomField,
  scanCommitments,
  scanSwaps,
  serializeNote,
  serializeSwap,
  swapCommitment,
  swapOwnerTag,
  toHex32,
  type ExtData,
  type Note,
  type OwnedNote,
  type ShieldedAddress,
} from '@elysian/core';

const NODE = process.env.NODE_URL ?? 'http://127.0.0.1:8787';
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
// One "unit" of the scenario. Locally 1 token; on mainnet set UNIT to something small, e.g. 50000 = 0.05 USDG.
const E18 = BigInt(process.env.UNIT ?? (10n ** 18n).toString());
const root = path.resolve(import.meta.dirname, '../..');
const dep = JSON.parse(fs.readFileSync(path.join(root, `contracts/deployments/${process.env.DEPLOYMENT ?? 'localhost'}.json`), 'utf8'));

const account = privateKeyToAccount((process.env.WALLET_KEY ?? DEPLOYER) as `0x${string}`);
const chain = { ...hardhat, id: dep.chainId as number };
/** A real chain: real money. Keys must be recoverable, withdrawals must come back to us, and time cannot be nudged. */
const REAL = dep.chainId !== 31337;
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, transport: http(RPC), account });

const poolAbi = parseAbi([
  'struct Proof { bytes proof; bytes32 root; bytes32[2] inputNullifiers; bytes32[2] outputCommitments; uint256 publicAmount; uint256 assetId; bytes32 extDataHash; }',
  'struct ExtData { address recipient; int256 extAmount; address relayer; uint256 fee; bytes encryptedOutput1; bytes encryptedOutput2; bytes adapterData; }',
  'function transact(Proof args, ExtData extData)',
]);
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);

const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString('hex')}` as `0x${string}`;
const get = async <T,>(p: string) => (await fetch(`${NODE}${p}`)).json() as Promise<T>;
const post = async <T,>(p: string, body: unknown) => {
  const r = await fetch(`${NODE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error);
  return j;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`  ${m}`);

async function prove(name: 'transaction' | 'swapClaim', inputs: Record<string, unknown>) {
  const dir = path.join(root, 'circuits/build', name);
  const { proof } = await snarkjs.groth16.fullProve(inputs, path.join(dir, `${name}_js/${name}.wasm`), path.join(dir, `${name}.zkey`));
  return encodeProof(proof);
}

interface NodeState { poolLeaves: number; swapLeaves: number; relayer: `0x${string}`; relayFeeBps: number; currentBatch: string; batchDuration: number }

async function waitForLeaves(n: number) {
  for (let i = 0; i < 60; i++) {
    const s = await get<NodeState>('/state');
    if (s.poolLeaves >= n) return s;
    await sleep(1000);
  }
  throw new Error('node did not index in time');
}

async function syncWallet(key: SpendingKey, tree: MerkleTree) {
  const { rows } = await get<{ rows: { index: number; commitment: string; ciphertext: string }[] }>(`/commitments?from=${tree.size}`);
  for (const r of rows) if (r.index === tree.size) tree.insert(BigInt(r.commitment));
  const all = await get<{ rows: { index: number; commitment: string; ciphertext: string }[] }>('/commitments?from=0');
  const notes = scanCommitments(key, all.rows.map((r) => ({ commitment: BigInt(r.commitment), index: r.index, ciphertext: hexToBytes(r.ciphertext) })));
  const spent = new Set((await get<{ rows: string[] }>('/nullifiers')).rows.map((x) => BigInt(x)));
  return notes.filter((n) => !spent.has(n.nullifier) && n.amount > 0n);
}

async function build(key: SpendingKey, tree: MerkleTree, asset: `0x${string}`, inputs: OwnedNote[], outputs: { note: Note; to: ShieldedAddress }[], ext: Partial<ExtData> & { extAmount: bigint }) {
  const assetId = assetToId(asset);
  while (outputs.length < 2) outputs.push({ note: dummyNote(assetId, key.pk), to: key.address() });
  const extData: ExtData = {
    recipient: ext.recipient ?? ZERO_ADDRESS,
    extAmount: ext.extAmount,
    relayer: ext.relayer ?? ZERO_ADDRESS,
    fee: ext.fee ?? 0n,
    encryptedOutput1: encryptTo(outputs[0].to.encPub, serializeNote(outputs[0].note)),
    encryptedOutput2: encryptTo(outputs[1].to.encPub, serializeNote(outputs[1].note)),
    adapterData: ext.adapterData ?? new Uint8Array(),
  };
  const edh = extDataHash(extData, { chainId: dep.chainId, contract: dep.pool });
  const paths = await Promise.all(
    inputs.map(async (n) => {
      const p = await get<{ root: string; pathElements: string[] }>(`/path/${n.leafIndex}`);
      return { note: n, leafIndex: n.leafIndex, path: { pathElements: p.pathElements.map(BigInt), pathIndices: n.leafIndex, root: BigInt(p.root) } };
    }),
  );
  const w = buildTransactionWitness({ key, assetId, inputs: paths, outputs: outputs.map((o) => o.note), publicAmount: publicAmount(extData.extAmount, extData.fee), extDataHash: edh, tree: paths[0] ? ({ root: paths[0].path.root } as MerkleTree) : tree });
  const proof = await prove('transaction', w.circuitInputs);
  return {
    args: { proof, root: toHex32(w.root), inputNullifiers: [toHex32(w.inputNullifiers[0]), toHex32(w.inputNullifiers[1])] as [`0x${string}`, `0x${string}`], outputCommitments: [toHex32(w.outputCommitments[0]), toHex32(w.outputCommitments[1])] as [`0x${string}`, `0x${string}`], publicAmount: publicAmount(extData.extAmount, extData.fee), assetId, extDataHash: toHex32(edh) },
    extData: { ...extData, encryptedOutput1: hex(extData.encryptedOutput1), encryptedOutput2: hex(extData.encryptedOutput2), adapterData: hex(extData.adapterData) },
  };
}

async function main() {
  const state = await get<NodeState>('/state');
  // Locally the demo pair; on mainnet pass the real tokens (the labels in the log stay NVDA and USDG).
  const NVDA = (process.env.ASSET_IN ?? dep.tokens.NVDA) as `0x${string}`;
  const USDG = (process.env.ASSET_OUT ?? dep.tokens.USDG) as `0x${string}`;
  // On a real chain the shielded keys are derived from the wallet, so whatever this run leaves in the pool can
  // always be recovered by running it again. Random throwaway keys are for the local chain only.
  const alice = REAL ? SpendingKey.fromSignature(await account.signMessage({ message: 'elysian smoke: alice' })) : SpendingKey.random();
  const bob = REAL ? SpendingKey.fromSignature(await account.signMessage({ message: 'elysian smoke: bob' })) : SpendingKey.random();
  const tree = new MerkleTree(TREE_LEVELS);
  console.log(`smoke: node ${NODE}, pool ${dep.pool}, relayer ${state.relayer}, leaves ${state.poolLeaves}`);

  // 1. shield 100 NVDA from the deployer wallet
  console.log('1. shield');
  await syncWallet(alice, tree);
  let tx = await build(alice, tree, NVDA, [], [{ note: createNote(NVDA, 100n * E18, alice.pk), to: alice.address() }], { extAmount: 100n * E18 });
  let h = await wallet.writeContract({ address: NVDA, abi: erc20, functionName: 'approve', args: [dep.pool, 100n * E18] });
  await pub.waitForTransactionReceipt({ hash: h });
  h = await wallet.writeContract({ address: dep.pool, abi: poolAbi, functionName: 'transact', args: [tx.args, tx.extData] });
  await pub.waitForTransactionReceipt({ hash: h });
  const leaves0 = state.poolLeaves;
  await waitForLeaves(leaves0 + 2);
  let notes = await syncWallet(alice, tree);
  log(`alice shielded balance ${notes.reduce((a, n) => a + n.amount, 0n) / E18} NVDA (indexed by node)`);

  // 2. relayed private transfer 30 NVDA to bob; the relay's flat minimum comes out of alice's change
  console.log('2. private transfer via /relay');
  const flat = BigInt((await get<{ flat: string }>(`/relay/fee/${NVDA}`)).flat);
  tx = await build(alice, tree, NVDA, [notes[0]], [{ note: createNote(NVDA, 30n * E18, bob.pk), to: bob.address() }, { note: createNote(NVDA, 70n * E18 - flat, alice.pk), to: alice.address() }], { extAmount: 0n, relayer: state.relayer, fee: flat });
  const r1 = await post<{ hash: `0x${string}` }>('/relay', tx);
  await pub.waitForTransactionReceipt({ hash: r1.hash });
  await waitForLeaves(leaves0 + 4);
  const bobNotes = await syncWallet(bob, tree);
  notes = await syncWallet(alice, tree);
  log(`bob ${bobNotes.reduce((a, n) => a + n.amount, 0n) / E18} NVDA, alice ${Number(notes.reduce((a, n) => a + n.amount, 0n)) / Number(E18)} NVDA (flat relay fee ${Number(flat) / Number(E18)})`);

  // 2b. the relayer refuses what it should refuse
  console.log('2b. relay rejections');
  {
    const fresh = await syncWallet(alice, tree);
    const wrongRelayer = await build(alice, tree, NVDA, [fresh[0]], [{ note: createNote(NVDA, fresh[0].amount, alice.pk), to: alice.address() }], { extAmount: 0n, relayer: '0x00000000000000000000000000000000000000cc', fee: 0n });
    const r1x = await fetch(`${NODE}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(wrongRelayer, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) });
    if (r1x.status !== 400) throw new Error('relay accepted a foreign relayer');
    const lowFee = await build(alice, tree, NVDA, [fresh[0]], [{ note: createNote(NVDA, fresh[0].amount - 10n * E18, alice.pk), to: alice.address() }], { extAmount: -(10n * E18), recipient: '0x00000000000000000000000000000000000000dd', relayer: state.relayer, fee: 0n });
    const r2x = await fetch(`${NODE}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lowFee, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) });
    if (r2x.status !== 400) throw new Error('relay accepted a fee below the minimum');
    const shieldViaRelay = await build(alice, tree, NVDA, [], [{ note: createNote(NVDA, 1n * E18, alice.pk), to: alice.address() }], { extAmount: 1n * E18, relayer: state.relayer });
    const r3x = await fetch(`${NODE}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(shieldViaRelay, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) });
    if (r3x.status !== 400) throw new Error('relay accepted a shield');
    log('foreign relayer, low fee and relayed shield all refused');
  }

  // 3. bob unshields 30 NVDA to a fresh address through the relayer, paying the minimum fee
  console.log('3. relayed unshield with fee');
  const recipient = REAL ? account.address : '0x00000000000000000000000000000000000000aa';
  const share = (30n * E18 * BigInt(state.relayFeeBps)) / 10_000n;
  const fee = share > flat ? share : flat;
  tx = await build(bob, tree, NVDA, [bobNotes[0]], [], { extAmount: -(30n * E18 - fee), recipient, relayer: state.relayer, fee });
  const r2 = await post<{ hash: `0x${string}` }>('/relay', tx);
  await pub.waitForTransactionReceipt({ hash: r2.hash });
  const got = await pub.readContract({ address: NVDA, abi: erc20, functionName: 'balanceOf', args: [recipient] });
  log(`recipient received ${Number(got) / 1e18} NVDA, relayer earned ${Number(fee) / 1e18} NVDA`);
  await waitForLeaves(leaves0 + 6);

  // 4. alice swaps 10 NVDA -> USDG in a sealed batch
  console.log('4. swap intent');
  notes = await syncWallet(alice, tree);
  const s = await get<NodeState>('/state');
  const chainNow = Number((await pub.getBlock({ blockTag: 'pending' })).timestamp);
  const nowBatch = BigInt(Math.floor(chainNow / s.batchDuration));
  const secondsLeft = Number((nowBatch + 1n) * BigInt(s.batchDuration)) - chainNow;
  const batchId = secondsLeft > 20 ? nowBatch : nowBatch + 1n;
  const intent = { batchId, assetIn: assetToId(NVDA), assetOut: assetToId(USDG), amountIn: 10n * E18, pk: alice.pk, blinding: randomField() };
  const commitment = swapCommitment(intent);
  tx = await build(alice, tree, NVDA, [notes[0]], [{ note: createNote(NVDA, notes[0].amount - 10n * E18, alice.pk), to: alice.address() }], {
    extAmount: -(10n * E18),
    recipient: dep.swap,
    adapterData: encodeSwapAdapterData(USDG, swapOwnerTag(intent), batchId, encryptTo(alice.encPub, serializeSwap(intent))),
  });
  h = await wallet.writeContract({ address: dep.pool, abi: poolAbi, functionName: 'transact', args: [tx.args, tx.extData] });
  await pub.waitForTransactionReceipt({ hash: h });
  log(`intent sealed into batch ${batchId}; waiting for the executor to clear it`);

  // 5. wait for the node's executor
  const swapTree = new MerkleTree(TREE_LEVELS);
  let batch: { executed: boolean; totalIn: string; totalOut: string } | undefined;
  for (let i = 0; i < 150; i++) {
    const b = await get<{ rows: { batchId: string; assetIn: string; assetOut: string; executed: boolean; totalIn: string; totalOut: string }[] }>(`/batches?assetIn=${NVDA}&assetOut=${USDG}`);
    batch = b.rows.find((r) => r.batchId === batchId.toString());
    if (batch?.executed) break;
    // hardhat only mines on transactions; nudge time forward so the batch closes
    if (!REAL) await pub.request({ method: 'evm_mine' as never, params: [] as never });
    await sleep(2000);
  }
  if (!batch?.executed) throw new Error('batch never executed');
  log(`batch cleared: ${Number(batch.totalIn) / 1e18} NVDA -> ${(Number(batch.totalOut) / 1e18).toFixed(2)} USDG`);

  // 6. claim via /claim
  console.log('5. claim via /claim');
  const swaps = await get<{ rows: { index: number; commitment: string; batchId: string; assetIn: string; assetOut: string; amountIn: string; ciphertext: string }[] }>('/swaps?from=0');
  for (const r of swaps.rows) if (r.index === swapTree.size) swapTree.insert(BigInt(r.commitment));
  const mine = scanSwaps(alice, swaps.rows.map((r) => ({ commitment: BigInt(r.commitment), index: r.index, batchId: BigInt(r.batchId), assetIn: BigInt(r.assetIn), assetOut: BigInt(r.assetOut), amountIn: BigInt(r.amountIn), ciphertext: hexToBytes(r.ciphertext) })));
  const owned = mine.find((m) => m.commitment === commitment)!;
  const p = await get<{ root: string; pathElements: string[] }>(`/swap-path/${owned.leafIndex}`);
  const w = buildSwapClaimWitness({ key: alice, domain: { chainId: dep.chainId, contract: dep.swap }, encPub: alice.encPub, swap: owned, path: { pathElements: p.pathElements.map(BigInt), pathIndices: owned.leafIndex, root: BigInt(p.root) }, totalIn: BigInt(batch.totalIn), totalOut: BigInt(batch.totalOut), outBlinding: randomField() });
  const proof = await prove('swapClaim', w.circuitInputs);
  const r3 = await post<{ hash: `0x${string}` }>('/claim', {
    proof,
    swapRoot: toHex32(w.swapRoot),
    batchId: batchId.toString(),
    assetIn: NVDA,
    assetOut: USDG,
    nullifier: toHex32(w.nullifier),
    outputCommitment: toHex32(w.outputCommitment),
    encryptedOutput: hex(w.encryptedOutput),
  });
  await pub.waitForTransactionReceipt({ hash: r3.hash });
  await waitForLeaves(leaves0 + 9);
  notes = await syncWallet(alice, tree);
  const usdg = notes.filter((n) => n.asset === assetToId(USDG)).reduce((a, n) => a + n.amount, 0n);
  const nvda = notes.filter((n) => n.asset === assetToId(NVDA)).reduce((a, n) => a + n.amount, 0n);
  log(`alice now holds ${nvda / E18} NVDA and ${(Number(usdg) / 1e18).toFixed(2)} USDG, all shielded`);
  console.log(`   alice's viewing key, to try in /explorer: ${encodeViewingKey(alice.viewingKey())}`);

  // 7. on a real chain, walk everything back out to the wallet: nothing is left behind in the pool
  if (REAL) {
    console.log('7. full exit');
    for (const asset of [NVDA, USDG]) {
      for (;;) {
        notes = (await syncWallet(alice, tree)).filter((n) => n.asset === assetToId(asset));
        if (!notes.length) break;
        const spend = notes.slice(0, 2);
        const total = spend.reduce((a, n) => a + n.amount, 0n);
        const out = await build(alice, tree, asset, spend, [], { extAmount: -total, recipient: account.address });
        const before = (await get<NodeState>('/state')).poolLeaves;
        h = await wallet.writeContract({ address: dep.pool, abi: poolAbi, functionName: 'transact', args: [out.args, out.extData] });
        await pub.waitForTransactionReceipt({ hash: h });
        await waitForLeaves(before + 2);
        log(`withdrew ${total} raw units of ${asset} to ${account.address} in ${h}`);
      }
    }
  }
  console.log('smoke: ok');
  process.exit(0);
}

main().catch((e) => {
  console.error('smoke failed:', e.message);
  process.exit(1);
});

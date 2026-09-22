/**
 * Withdraw notes from the version 1 pool. Version 2 changed the key derivation message, the proof binding and the
 * proving keys, so the app cannot see or spend version 1 notes. This tool derives the version 1 keys, reads the
 * version 1 pool straight from the chain, builds the tree locally, proves with the archived version 1 keys and
 * submits `transact` from the wallet. See docs/RECOVERY.md.
 *
 *   WALLET_KEY=0x… DRY=1 npx tsx node/scripts/exit-v1.ts     # scan and report
 *   WALLET_KEY=0x… npx tsx node/scripts/exit-v1.ts           # withdraw everything to the wallet
 *
 * Env: WALLET_KEY (signs the version 1 message and pays gas), SPENDING_KEY (raw version 1 key instead of the signature),
 *      RECIPIENT (defaults to the wallet), ALCHEMY_KEY or RPC_URL, LOG_RANGE (blocks per getLogs call, default 5000).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as snarkjs from 'snarkjs';
import { createPublicClient, createWalletClient, defineChain, http, parseAbiItem, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  KEY_DERIVATION_MESSAGE_V1,
  MerkleTree,
  SpendingKey,
  TREE_LEVELS,
  ZERO_ADDRESS,
  assetToAddress,
  balances,
  buildTransactionWitness,
  dummyNote,
  encodeProof,
  encryptTo,
  hexToBytes,
  legacyExtDataHash,
  publicAmount,
  scanCommitments,
  scanSwaps,
  serializeNote,
  toHex32,
  type ExtData,
} from '@elysian/core';
import { poolAbi } from '../src/abi.js';

const root = path.resolve(import.meta.dirname, '../..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const archive = path.join(root, 'circuits/archive/v1-2026-09-21');
const dep = JSON.parse(fs.readFileSync(path.join(archive, 'deployment.json'), 'utf8')) as { chainId: number; pool: Hex; swap: Hex; startBlock: number };
const rpcUrl = process.env.RPC_URL ?? (process.env.ALCHEMY_KEY ? `https://robinhood-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}` : 'https://rpc.mainnet.chain.robinhood.com');
const chain = defineChain({ id: dep.chainId, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const LOG_RANGE = BigInt(process.env.LOG_RANGE ?? 5000);
const DRY = process.env.DRY === '1';

const NewCommitment = parseAbiItem('event NewCommitment(bytes32 indexed commitment, uint256 index, bytes encryptedOutput)');
const NewNullifier = parseAbiItem('event NewNullifier(bytes32 indexed nullifier)');
const SwapIntent = parseAbiItem('event SwapIntent(bytes32 indexed commitment, uint256 index, uint256 indexed batchId, address assetIn, address assetOut, uint256 amountIn, bytes ciphertext)');
const SwapClaimed = parseAbiItem('event SwapClaimed(bytes32 indexed nullifier, bytes32 indexed outputCommitment)');

async function main() {
  if (!process.env.WALLET_KEY) throw new Error('set WALLET_KEY');
  const account = privateKeyToAccount(process.env.WALLET_KEY as Hex);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const recipient = (process.env.RECIPIENT ?? account.address) as Hex;
  const key = process.env.SPENDING_KEY ? SpendingKey.fromHex(process.env.SPENDING_KEY) : SpendingKey.fromSignature(await wallet.signMessage({ message: KEY_DERIVATION_MESSAGE_V1(dep.chainId) }));
  console.log(`version 1 pool ${dep.pool} on chain ${dep.chainId}; wallet ${account.address}; withdrawing to ${recipient}${DRY ? ' (dry run)' : ''}`);

  // The whole public log, in order, straight from the chain.
  const head = await client.getBlockNumber();
  const commitments: { commitment: bigint; index: number; ciphertext: Uint8Array }[] = [];
  const spent = new Set<bigint>();
  const orders: { commitment: bigint; index: number; batchId: bigint; assetIn: bigint; assetOut: bigint; amountIn: bigint; ciphertext: Uint8Array }[] = [];
  const claimed = new Set<bigint>();
  for (let from = BigInt(dep.startBlock); from <= head; from += LOG_RANGE) {
    const to = from + LOG_RANGE - 1n < head ? from + LOG_RANGE - 1n : head;
    const [c, n, s, k] = await Promise.all([
      client.getLogs({ address: dep.pool, event: NewCommitment, fromBlock: from, toBlock: to }),
      client.getLogs({ address: dep.pool, event: NewNullifier, fromBlock: from, toBlock: to }),
      client.getLogs({ address: dep.swap, event: SwapIntent, fromBlock: from, toBlock: to }),
      client.getLogs({ address: dep.swap, event: SwapClaimed, fromBlock: from, toBlock: to }),
    ]);
    for (const l of c) commitments.push({ commitment: BigInt(l.args.commitment!), index: Number(l.args.index!), ciphertext: hexToBytes(l.args.encryptedOutput!) });
    for (const l of n) spent.add(BigInt(l.args.nullifier!));
    for (const l of s) orders.push({ commitment: BigInt(l.args.commitment!), index: Number(l.args.index!), batchId: l.args.batchId!, assetIn: BigInt(l.args.assetIn!), assetOut: BigInt(l.args.assetOut!), amountIn: l.args.amountIn!, ciphertext: hexToBytes(l.args.ciphertext!) });
    for (const l of k) claimed.add(BigInt(l.args.nullifier!));
  }
  commitments.sort((a, b) => a.index - b.index);
  const tree = new MerkleTree(TREE_LEVELS);
  for (const c of commitments) {
    if (c.index !== tree.size) throw new Error(`commitment log has a gap at ${tree.size}`);
    tree.insert(c.commitment);
  }
  console.log(`${commitments.length} commitments, ${spent.size} nullifiers, ${orders.length} orders, ${claimed.size} claims; tree root ${toHex32(tree.root)}`);

  const notes = scanCommitments(key, commitments);
  const mine = balances(notes, spent).filter((b) => b.amount > 0n);
  const myOrders = scanSwaps(key, orders).filter((o) => !claimed.has(o.nullifier));
  if (!mine.length) console.log('no unspent version 1 notes for this key');
  for (const b of mine) console.log(`  ${assetToAddress(b.asset)}  ${b.amount} (raw units) in ${b.notes.length} note${b.notes.length === 1 ? '' : 's'}`);
  if (myOrders.length) console.log(`  ${myOrders.length} unclaimed version 1 order${myOrders.length === 1 ? '' : 's'}: this tool withdraws notes only; claiming needs the version 1 claim circuit`);
  if (DRY || !mine.length) return;

  const wasm = path.join(archive, 'transaction.wasm');
  const zkey = path.join(archive, 'transaction.zkey');
  for (const b of mine) {
    const asset = assetToAddress(b.asset);
    const remaining = [...b.notes].sort((x, y) => (y.amount > x.amount ? 1 : -1));
    while (remaining.length) {
      const inputs = remaining.splice(0, 2);
      const amount = inputs.reduce((a, n) => a + n.amount, 0n);
      // Everything leaves the pool: both outputs are zero-value placeholders.
      const outputs = [dummyNote(b.asset, key.pk), dummyNote(b.asset, key.pk)];
      const ext: ExtData = {
        recipient,
        extAmount: -amount,
        relayer: ZERO_ADDRESS,
        fee: 0n,
        encryptedOutput1: encryptTo(key.encPub, serializeNote(outputs[0])),
        encryptedOutput2: encryptTo(key.encPub, serializeNote(outputs[1])),
        adapterData: new Uint8Array(),
      };
      const edh = legacyExtDataHash(ext);
      const pa = publicAmount(ext.extAmount, ext.fee);
      const w = buildTransactionWitness({ key, assetId: b.asset, inputs: inputs.map((n) => ({ note: n, leafIndex: n.leafIndex, path: tree.path(n.leafIndex) })), outputs, publicAmount: pa, extDataHash: edh, tree });
      const { proof } = await snarkjs.groth16.fullProve(w.circuitInputs, wasm, zkey);
      const args = {
        proof: encodeProof(proof) as Hex,
        root: toHex32(w.root),
        inputNullifiers: [toHex32(w.inputNullifiers[0]), toHex32(w.inputNullifiers[1])] as [Hex, Hex],
        outputCommitments: [toHex32(w.outputCommitments[0]), toHex32(w.outputCommitments[1])] as [Hex, Hex],
        publicAmount: pa,
        assetId: b.asset,
        extDataHash: toHex32(edh),
      };
      const hex = (u: Uint8Array) => `0x${Buffer.from(u).toString('hex')}` as Hex;
      const extSol = { ...ext, encryptedOutput1: hex(ext.encryptedOutput1), encryptedOutput2: hex(ext.encryptedOutput2), adapterData: hex(ext.adapterData) };
      const { request } = await client.simulateContract({ address: dep.pool, abi: poolAbi, functionName: 'transact', args: [args, extSol], account });
      const hash = await wallet.writeContract(request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      console.log(`  withdrew ${amount} of ${asset} to ${recipient}: ${hash} (${receipt.status})`);
      for (const n of inputs) spent.add(n.nullifier);
    }
  }
  console.log('done');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

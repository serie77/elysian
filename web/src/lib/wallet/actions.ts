'use client';

/**
 * High-level shielded operations. Each one builds notes, encrypts them, proves in the worker and
 * hands the bundle back for the relayer (or, on request, the connected wallet) to submit. Merkle
 * paths come from the wallet's own mirror of each tree, so no server learns which leaf a proof uses.
 */
import {
  ZERO_ADDRESS,
  assetToId,
  buildSwapClaimWitness,
  buildTransactionWitness,
  createNote,
  decodeAddress,
  dummyNote,
  encodeProof,
  encodeSwapAdapterData,
  encryptTo,
  extDataHash as hashExtData,
  type Domain,
  publicAmount as toPublicAmount,
  randomField,
  selectNotes,
  serializeNote,
  serializeSwap,
  swapOwnerTag,
  toHex32,
  type ExtData,
  type Note,
  type OwnedNote,
  type OwnedSwap,
  type ShieldedAddress,
  type SpendingKey,
} from '@elysian/core';
import type { MerkleTree } from '@elysian/core';
import { prove, type ProveProgress } from './prover';

const bytesToHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

export interface TransactBundle {
  args: {
    proof: `0x${string}`;
    root: `0x${string}`;
    inputNullifiers: [`0x${string}`, `0x${string}`];
    outputCommitments: [`0x${string}`, `0x${string}`];
    publicAmount: bigint;
    assetId: bigint;
    extDataHash: `0x${string}`;
  };
  extData: {
    recipient: `0x${string}`;
    extAmount: bigint;
    relayer: `0x${string}`;
    fee: bigint;
    encryptedOutput1: `0x${string}`;
    encryptedOutput2: `0x${string}`;
    adapterData: `0x${string}`;
  };
  ms: number;
}

/** What every recipe needs: the key, the (chain, contract) pair hashes are bound to, and the wallet's mirror of the tree. */
export interface TxContext {
  key: SpendingKey;
  domain: Domain;
  tree: MerkleTree;
  /** Confirms the mirrored root is one the contract accepts: a generic read that names no leaf. */
  verifyRoot?: (root: bigint) => Promise<boolean>;
}

interface BuildParams extends TxContext {
  asset: `0x${string}`;
  inputs: OwnedNote[];
  outputs: { note: Note; to: ShieldedAddress; memo?: string }[];
  extAmount: bigint;
  recipient?: `0x${string}`;
  relayer?: `0x${string}`;
  fee?: bigint;
  adapterData?: Uint8Array;
  onProgress?: (p: ProveProgress) => void;
}

export async function buildTransaction(p: BuildParams): Promise<TransactBundle> {
  const assetId = assetToId(p.asset);
  const outputs = [...p.outputs];
  while (outputs.length < 2) outputs.push({ note: dummyNote(assetId, p.key.pk), to: p.key.address() });
  // Payment, change and padding take a random order, so position says nothing about a note's role.
  if (crypto.getRandomValues(new Uint8Array(1))[0] & 1) outputs.reverse();

  const ext: ExtData = {
    recipient: p.recipient ?? ZERO_ADDRESS,
    extAmount: p.extAmount,
    relayer: p.relayer ?? ZERO_ADDRESS,
    fee: p.fee ?? 0n,
    encryptedOutput1: encryptTo(outputs[0].to.encPub, serializeNote(outputs[0].note, outputs[0].memo)),
    encryptedOutput2: encryptTo(outputs[1].to.encPub, serializeNote(outputs[1].note, outputs[1].memo)),
    adapterData: p.adapterData ?? new Uint8Array(),
  };
  const edh = hashExtData(ext, p.domain);
  const publicAmount = toPublicAmount(ext.extAmount, ext.fee);

  // Witnesses come from the wallet's own mirror of the tree, so no server learns which notes are being spent.
  if (p.inputs.length && p.verifyRoot && !(await p.verifyRoot(p.tree.root))) throw new Error('Your wallet is still catching up with the chain. Try again in a moment.');
  const inputs = p.inputs.map((n) => ({ note: n, leafIndex: n.leafIndex, path: p.tree.path(n.leafIndex) }));
  const witness = buildTransactionWitness({
    key: p.key,
    assetId,
    inputs,
    outputs: outputs.map((o) => o.note),
    publicAmount,
    extDataHash: edh,
    tree: p.tree,
  });

  const { proof, ms } = await prove('transaction', witness.circuitInputs, p.onProgress);
  return {
    args: {
      proof: encodeProof(proof),
      root: toHex32(witness.root),
      inputNullifiers: [toHex32(witness.inputNullifiers[0]), toHex32(witness.inputNullifiers[1])],
      outputCommitments: [toHex32(witness.outputCommitments[0]), toHex32(witness.outputCommitments[1])],
      publicAmount,
      assetId,
      extDataHash: toHex32(edh),
    },
    extData: {
      recipient: ext.recipient,
      extAmount: ext.extAmount,
      relayer: ext.relayer,
      fee: ext.fee,
      encryptedOutput1: bytesToHex(ext.encryptedOutput1),
      encryptedOutput2: bytesToHex(ext.encryptedOutput2),
      adapterData: bytesToHex(ext.adapterData),
    },
    ms,
  };
}

/* --------------------------------- recipes --------------------------------- */

export function planShield(ctx: TxContext, asset: `0x${string}`, amount: bigint, onProgress?: BuildParams['onProgress']) {
  const note = createNote(asset, amount, ctx.key.pk);
  return buildTransaction({ ...ctx, asset, inputs: [], outputs: [{ note, to: ctx.key.address() }], extAmount: amount, onProgress });
}

export function planTransfer(
  ctx: TxContext,
  asset: `0x${string}`,
  notes: OwnedNote[],
  amount: bigint,
  toAddress: string,
  memo: string | undefined,
  relayer: `0x${string}` | undefined,
  fee: bigint,
  onProgress?: BuildParams['onProgress'],
) {
  const to = decodeAddress(toAddress);
  const inputs = selectNotes(notes, amount + fee);
  const total = inputs.reduce((a, n) => a + n.amount, 0n);
  const change = total - amount - fee;
  const outputs: { note: Note; to: ShieldedAddress; memo?: string }[] = [{ note: createNote(asset, amount, to.pk), to, memo }];
  if (change > 0n) outputs.push({ note: createNote(asset, change, ctx.key.pk), to: ctx.key.address() });
  return buildTransaction({ ...ctx, asset, inputs, outputs, extAmount: 0n, relayer, fee, onProgress });
}

export function planUnshield(
  ctx: TxContext,
  asset: `0x${string}`,
  notes: OwnedNote[],
  amount: bigint,
  recipient: `0x${string}`,
  relayer: `0x${string}` | undefined,
  fee: bigint,
  onProgress?: BuildParams['onProgress'],
) {
  const inputs = selectNotes(notes, amount + fee);
  const total = inputs.reduce((a, n) => a + n.amount, 0n);
  const change = total - amount - fee;
  const outputs = change > 0n ? [{ note: createNote(asset, change, ctx.key.pk), to: ctx.key.address() }] : [];
  return buildTransaction({ ...ctx, asset, inputs, outputs, extAmount: -amount, recipient, relayer, fee, onProgress });
}

export interface SwapPlan {
  bundle: TransactBundle;
  intent: { batchId: bigint; assetIn: bigint; assetOut: bigint; amountIn: bigint; pk: bigint; blinding: bigint };
}

/** A sealed order: the pool moves amountIn to the swap adapter, and the relayer's fee comes out of the same notes. */
export async function planSwap(
  ctx: TxContext,
  assetIn: `0x${string}`,
  assetOut: `0x${string}`,
  notes: OwnedNote[],
  amountIn: bigint,
  batchId: bigint,
  swapContract: `0x${string}`,
  relayer: `0x${string}` | undefined,
  fee: bigint,
  onProgress?: BuildParams['onProgress'],
): Promise<SwapPlan> {
  const intent = { batchId, assetIn: assetToId(assetIn), assetOut: assetToId(assetOut), amountIn, pk: ctx.key.pk, blinding: randomField() };
  const ciphertext = encryptTo(ctx.key.encPub, serializeSwap(intent));
  const inputs = selectNotes(notes, amountIn + fee);
  const total = inputs.reduce((a, n) => a + n.amount, 0n);
  const change = total - amountIn - fee;
  const outputs = change > 0n ? [{ note: createNote(assetIn, change, ctx.key.pk), to: ctx.key.address() }] : [];
  const bundle = await buildTransaction({
    ...ctx,
    asset: assetIn,
    inputs,
    outputs,
    extAmount: -amountIn,
    recipient: swapContract,
    relayer,
    fee,
    adapterData: encodeSwapAdapterData(assetOut, swapOwnerTag(intent), batchId, ciphertext),
    onProgress,
  });
  return { bundle, intent };
}

/** Claim a cleared order. The context's tree is the swap tree and its domain names the swap contract. */
export async function planClaim(ctx: TxContext, swap: OwnedSwap, totalIn: bigint, totalOut: bigint, refunded: boolean, onProgress?: BuildParams['onProgress']) {
  if (ctx.verifyRoot && !(await ctx.verifyRoot(ctx.tree.root))) throw new Error('Your wallet is still catching up with the chain. Try again in a moment.');
  const witness = buildSwapClaimWitness({
    key: ctx.key,
    swap,
    path: ctx.tree.path(swap.leafIndex),
    totalIn,
    totalOut,
    outBlinding: randomField(),
    refunded,
    domain: ctx.domain,
    encPub: ctx.key.encPub,
  });
  const { proof, ms } = await prove('swapClaim', witness.circuitInputs, onProgress);
  const assetAddr = (id: bigint) => `0x${id.toString(16).padStart(40, '0')}` as `0x${string}`;
  return {
    args: {
      proof: encodeProof(proof),
      swapRoot: toHex32(witness.swapRoot),
      batchId: swap.batchId,
      assetIn: assetAddr(swap.assetIn),
      assetOut: assetAddr(swap.assetOut),
      nullifier: toHex32(witness.nullifier),
      outputCommitment: toHex32(witness.outputCommitment),
      encryptedOutput: bytesToHex(witness.encryptedOutput),
    },
    output: witness.output,
    ms,
  };
}

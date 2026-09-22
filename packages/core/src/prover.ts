/**
 * Witness construction for the two circuits. Proving itself is done by snarkjs in the caller
 * (browser worker or node process); this module only shapes the inputs and formats the output.
 */
import { N_INPUTS, N_OUTPUTS, TREE_LEVELS } from './constants.js';
import type { MerklePath } from './merkle.js';
import type { MerkleTree } from './merkle.js';
import { dummyNote, type Note, noteCommitment, noteNullifier, serializeNote } from './note.js';
import { encryptTo } from './encryption.js';
import { claimDataHash, type Domain } from './extdata.js';
import type { SpendingKey } from './keys.js';
import { clearingOutput, swapCommitment, swapNullifier, type SwapIntent } from './swap.js';

export interface TransactionInput {
  note: Note;
  leafIndex: number;
  path: MerklePath;
}

export interface TransactionWitness {
  circuitInputs: Record<string, string | string[] | string[][]>;
  root: bigint;
  inputNullifiers: bigint[];
  outputCommitments: bigint[];
  outputs: Note[];
}

const s = (v: bigint | number) => v.toString();

export function buildTransactionWitness(params: {
  key: SpendingKey;
  assetId: bigint;
  inputs: TransactionInput[];
  outputs: Note[];
  publicAmount: bigint;
  extDataHash: bigint;
  tree: MerkleTree;
}): TransactionWitness {
  const { key, assetId, tree } = params;
  if (params.inputs.length > N_INPUTS) throw new Error(`at most ${N_INPUTS} inputs`);
  if (params.outputs.length > N_OUTPUTS) throw new Error(`at most ${N_OUTPUTS} outputs`);
  for (const i of params.inputs) {
    if (i.note.pk !== key.pk) throw new Error('input note is not owned by this key');
    if (i.note.asset !== assetId) throw new Error('input note asset mismatch');
  }

  const inputs: TransactionInput[] = [...params.inputs];
  while (inputs.length < N_INPUTS) {
    inputs.push({
      note: dummyNote(assetId, key.pk),
      leafIndex: 0,
      path: { pathElements: Array(TREE_LEVELS).fill(0n), pathIndices: 0, root: tree.root },
    });
  }
  const outputs: Note[] = [...params.outputs];
  while (outputs.length < N_OUTPUTS) outputs.push(dummyNote(assetId, key.pk));
  for (const o of outputs) if (o.asset !== assetId) throw new Error('output note asset mismatch');

  const root = tree.root;
  const leafIndexOf = (i: TransactionInput) => (i.note.amount === 0n ? 0 : i.leafIndex);
  const inputNullifiers = inputs.map((i) => noteNullifier(noteCommitment(i.note), leafIndexOf(i), key.nk));
  const outputCommitments = outputs.map(noteCommitment);

  const circuitInputs = {
    root: s(root),
    publicAmount: s(params.publicAmount),
    extDataHash: s(params.extDataHash),
    assetId: s(assetId),
    inputNullifier: inputNullifiers.map(s),
    outputCommitment: outputCommitments.map(s),
    sk: s(key.sk),
    inAmount: inputs.map((i) => s(i.note.amount)),
    inBlinding: inputs.map((i) => s(i.note.blinding)),
    inPathIndices: inputs.map((i) => s(leafIndexOf(i))),
    inPathElements: inputs.map((i) => i.path.pathElements.map(s)),
    outAmount: outputs.map((o) => s(o.amount)),
    outPk: outputs.map((o) => s(o.pk)),
    outBlinding: outputs.map((o) => s(o.blinding)),
  };

  return { circuitInputs, root, inputNullifiers, outputCommitments, outputs };
}

export interface SwapClaimWitness {
  circuitInputs: Record<string, string | string[]>;
  swapRoot: bigint;
  nullifier: bigint;
  outputCommitment: bigint;
  output: Note;
  /** The output note encrypted to its owner. Its hash is a public input, so nobody can swap it out. */
  encryptedOutput: Uint8Array;
  claimDataHash: bigint;
}

export function buildSwapClaimWitness(params: {
  key: SpendingKey;
  swap: SwapIntent;
  path: MerklePath;
  totalIn: bigint;
  totalOut: bigint;
  outBlinding: bigint;
  /** A cancelled batch pays the order back in assetIn; the contract reports totalOut = totalIn for it. */
  refunded?: boolean;
  /** Chain id and ElysianSwap address the claim is for. */
  domain: Domain;
  /** Encryption public key of the output's owner (the claimant). */
  encPub: Uint8Array;
}): SwapClaimWitness {
  const { key, swap, path } = params;
  if (swap.pk !== key.pk) throw new Error('swap is not owned by this key');
  const commitment = swapCommitment(swap);
  const nullifier = swapNullifier(commitment, key.nk);
  const { amountOut, remainder } = clearingOutput(swap.amountIn, params.totalIn, params.totalOut);
  const payoutAsset = params.refunded ? swap.assetIn : swap.assetOut;
  const output: Note = { asset: payoutAsset, amount: amountOut, pk: key.pk, blinding: params.outBlinding };
  const outputCommitment = noteCommitment(output);
  const encryptedOutput = encryptTo(params.encPub, serializeNote(output));
  const cdh = claimDataHash(params.domain, encryptedOutput);

  const circuitInputs = {
    claimDataHash: s(cdh),
    swapRoot: s(path.root),
    batchId: s(swap.batchId),
    assetIn: s(swap.assetIn),
    assetOut: s(swap.assetOut),
    payoutAsset: s(payoutAsset),
    totalIn: s(params.totalIn),
    totalOut: s(params.totalOut),
    swapNullifier: s(nullifier),
    outputCommitment: s(outputCommitment),
    sk: s(key.sk),
    amountIn: s(swap.amountIn),
    blinding: s(swap.blinding),
    pathIndices: s(path.pathIndices),
    pathElements: path.pathElements.map(s),
    amountOut: s(amountOut),
    remainder: s(remainder),
    outBlinding: s(params.outBlinding),
  };

  return { circuitInputs, swapRoot: path.root, nullifier, outputCommitment, output, encryptedOutput, claimDataHash: cdh };
}

/** snarkjs Groth16 proof -> abi.encode(uint[2] a, uint[2][2] b, uint[2] c) as 0x hex. */
export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}

export function encodeProof(proof: Groth16Proof): `0x${string}` {
  const words = [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
    proof.pi_c[0],
    proof.pi_c[1],
  ].map((w) => BigInt(w).toString(16).padStart(64, '0'));
  return `0x${words.join('')}` as `0x${string}`;
}

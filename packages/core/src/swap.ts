/**
 * Sealed batch swaps (Penumbra ZSwap lineage).
 *
 * A swap intent unshields amountIn of assetIn into the ElysianSwap adapter. The user supplies only
 * an owner tag; the contract folds in what it actually received, so the leaf cannot lie about size:
 *
 *   ownerTag       = Poseidon(DOMAIN.SWAP, pk, blinding)
 *   swapCommitment = H(H(H(H(ownerTag, amountIn), batchId), assetIn), assetOut)      H = Poseidon2
 *   swapNullifier  = Poseidon(DOMAIN.SWAP_NULLIFIER, nk, swapCommitment)
 *
 * The chain sees the pair and the amount, but not who submitted it. After the batch clears at a
 * single price, the owner proves knowledge of the commitment and mints a note of assetOut worth
 * floor(amountIn * totalOut / totalIn) directly into the pool tree.
 */
import { DOMAIN } from './constants.js';
import { bigIntToBytes, bytesToBigInt, concatBytes } from './field.js';
import { poseidon2, poseidon3 } from './hash.js';

export interface SwapIntent {
  batchId: bigint;
  assetIn: bigint;
  assetOut: bigint;
  amountIn: bigint;
  pk: bigint;
  blinding: bigint;
}

export interface OwnedSwap extends SwapIntent {
  commitment: bigint;
  leafIndex: number;
  nullifier: bigint;
}

/** The only part of an order its owner chooses. Hides who they are. */
export const swapOwnerTag = (s: Pick<SwapIntent, 'pk' | 'blinding'>): bigint => poseidon3([DOMAIN.SWAP, s.pk, s.blinding]);

/** Mirrors ElysianSwap.onShieldedTransfer, which builds the leaf from the amount it really received. */
export const swapCommitment = (s: SwapIntent): bigint =>
  [s.amountIn, s.batchId, s.assetIn, s.assetOut].reduce((acc, v) => poseidon2([acc, v]), swapOwnerTag(s));

export const swapNullifier = (commitment: bigint, nk: bigint): bigint =>
  poseidon3([DOMAIN.SWAP_NULLIFIER, nk, commitment]);

export function clearingOutput(amountIn: bigint, totalIn: bigint, totalOut: bigint): { amountOut: bigint; remainder: bigint } {
  if (totalIn === 0n) throw new Error('empty batch');
  const num = amountIn * totalOut;
  return { amountOut: num / totalIn, remainder: num % totalIn };
}

/** batchId(8) | assetIn(20) | assetOut(20) | amountIn(16) | blinding(32) */
export function serializeSwap(s: SwapIntent): Uint8Array {
  return concatBytes(
    bigIntToBytes(s.batchId, 8),
    bigIntToBytes(s.assetIn, 20),
    bigIntToBytes(s.assetOut, 20),
    bigIntToBytes(s.amountIn, 16),
    bigIntToBytes(s.blinding, 32),
  );
}

export function deserializeSwap(bytes: Uint8Array, pk: bigint): SwapIntent {
  if (bytes.length !== 96) throw new Error('swap plaintext malformed');
  return {
    batchId: bytesToBigInt(bytes.slice(0, 8)),
    assetIn: bytesToBigInt(bytes.slice(8, 28)),
    assetOut: bytesToBigInt(bytes.slice(28, 48)),
    amountIn: bytesToBigInt(bytes.slice(48, 64)),
    blinding: bytesToBigInt(bytes.slice(64, 96)),
    pk,
  };
}

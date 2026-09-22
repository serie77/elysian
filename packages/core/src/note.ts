/**
 * Notes are the unit of shielded value. Only their Poseidon commitment ever touches the chain.
 *
 *   commitment = Poseidon(amount, asset, pk, blinding)
 *   nullifier  = Poseidon(DOMAIN.NULLIFIER, nk, commitment, leafIndex)
 *
 * asset is the ERC-20 address as a uint160. amount is the raw token amount (18 decimals for
 * Robinhood stock tokens). blinding is fresh randomness that makes every commitment unique.
 */
import { DOMAIN, MAX_AMOUNT } from './constants.js';
import { bigIntToBytes, bytesToBigInt, concatBytes, randomField } from './field.js';
import { poseidon4 } from './hash.js';

export interface Note {
  asset: bigint;
  amount: bigint;
  pk: bigint;
  blinding: bigint;
}

export interface OwnedNote extends Note {
  commitment: bigint;
  leafIndex: number;
  nullifier: bigint;
  memo?: string;
}

export const assetToId = (address: string): bigint => BigInt(address.toLowerCase());
export const assetToAddress = (id: bigint): `0x${string}` =>
  `0x${id.toString(16).padStart(40, '0')}` as `0x${string}`;

export function createNote(asset: bigint | string, amount: bigint, pk: bigint, blinding: bigint = randomField()): Note {
  if (amount < 0n || amount > MAX_AMOUNT) throw new Error('amount out of range');
  return { asset: typeof asset === 'string' ? assetToId(asset) : asset, amount, pk, blinding };
}

export const dummyNote = (asset: bigint, pk: bigint): Note => createNote(asset, 0n, pk, randomField());

export const noteCommitment = (n: Note): bigint => poseidon4([n.amount, n.asset, n.pk, n.blinding]);

export const noteNullifier = (commitment: bigint, leafIndex: number | bigint, nk: bigint): bigint =>
  poseidon4([DOMAIN.NULLIFIER, nk, commitment, BigInt(leafIndex)]);

/* --------------------------- plaintext (de)serialisation --------------------------- */

const MEMO_MAX = 128;
const NOTE_VERSION = 2;
/** Every v2 plaintext is exactly this long, so a ciphertext's size says nothing about its memo. */
export const NOTE_PLAINTEXT_LENGTH = 1 + 20 + 16 + 32 + 1 + MEMO_MAX;

/** v2: version(1) | asset(20) | amount(16) | blinding(32) | memoLength(1) | memo padded to 128 */
export function serializeNote(n: Note, memo = ''): Uint8Array {
  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length > MEMO_MAX) throw new Error('memo too long');
  const padded = new Uint8Array(MEMO_MAX);
  padded.set(memoBytes);
  return concatBytes(new Uint8Array([NOTE_VERSION]), bigIntToBytes(n.asset, 20), bigIntToBytes(n.amount, 16), bigIntToBytes(n.blinding, 32), new Uint8Array([memoBytes.length]), padded);
}

export function deserializeNote(bytes: Uint8Array, pk: bigint): { note: Note; memo: string } {
  if (bytes.length === NOTE_PLAINTEXT_LENGTH && bytes[0] === NOTE_VERSION) {
    const memoLength = bytes[69];
    if (memoLength > MEMO_MAX) throw new Error('note plaintext malformed');
    return {
      note: { asset: bytesToBigInt(bytes.slice(1, 21)), amount: bytesToBigInt(bytes.slice(21, 37)), pk, blinding: bytesToBigInt(bytes.slice(37, 69)) },
      memo: new TextDecoder().decode(bytes.slice(70, 70 + memoLength)),
    };
  }
  // v1 (the first mainnet pool): asset(20) | amount(16) | blinding(32) | memo, unpadded.
  if (bytes.length < 68) throw new Error('note plaintext too short');
  const note: Note = {
    asset: bytesToBigInt(bytes.slice(0, 20)),
    amount: bytesToBigInt(bytes.slice(20, 36)),
    pk,
    blinding: bytesToBigInt(bytes.slice(36, 68)),
  };
  const memo = new TextDecoder().decode(bytes.slice(68));
  return { note, memo };
}

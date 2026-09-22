/**
 * ExtData is the public, non-proven half of a shielded transaction. Its keccak hash (reduced into
 * the field) is bound into the proof so a relayer cannot swap the recipient or the fee.
 * Layout mirrors ElysianPool.ExtData and is ABI-encoded as a tuple.
 */
import { FIELD_SIZE } from './constants.js';
import { bigIntToBytes, bytesToBigInt, concatBytes, mod } from './field.js';
import { keccak } from './hash.js';

export interface ExtData {
  recipient: `0x${string}`;
  extAmount: bigint; // positive = shield, negative = unshield / swap, zero = transfer
  relayer: `0x${string}`;
  fee: bigint;
  encryptedOutput1: Uint8Array;
  encryptedOutput2: Uint8Array;
  adapterData: Uint8Array;
}

const word = (v: bigint) => bigIntToBytes(mod(v, 1n << 256n), 32);
const addrWord = (a: string) => bigIntToBytes(BigInt(a), 32);

function encodeBytes(b: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(b.length / 32) * 32);
  padded.set(b);
  return concatBytes(word(BigInt(b.length)), padded);
}

/**
 * abi.encode((address,int256,address,uint256,bytes,bytes,bytes)): a dynamic tuple, so the
 * encoding is a 0x20 pointer followed by the head (7 words) and the three tails.
 * Solidity's abi.encode(extData) of the calldata struct yields exactly this.
 */
export function encodeExtData(e: ExtData): Uint8Array {
  const headSize = 7 * 32;
  const enc1 = encodeBytes(e.encryptedOutput1);
  const enc2 = encodeBytes(e.encryptedOutput2);
  const enc3 = encodeBytes(e.adapterData);
  const off1 = headSize;
  const off2 = off1 + enc1.length;
  const off3 = off2 + enc2.length;
  const tuple = concatBytes(
    addrWord(e.recipient),
    word(e.extAmount),
    addrWord(e.relayer),
    word(e.fee),
    word(BigInt(off1)),
    word(BigInt(off2)),
    word(BigInt(off3)),
    enc1,
    enc2,
    enc3,
  );
  return concatBytes(word(32n), tuple);
}

/** The deployment a proof is for. Bound into every hash so a proof made for one pool or chain is useless on another. */
export interface Domain {
  chainId: number | bigint;
  contract: `0x${string}`;
}

/** keccak(abi.encode(extData) ‖ abi.encode(chainId, pool)) reduced into the field. Mirrors ElysianPool._transact. */
export const extDataHash = (e: ExtData, domain: Domain): bigint =>
  mod(bytesToBigInt(keccak(concatBytes(encodeExtData(e), word(BigInt(domain.chainId)), addrWord(domain.contract)))), FIELD_SIZE);

/** keccak(abi.encode(chainId, swap, encryptedOutput)) reduced into the field. Mirrors ElysianSwap.claim. */
/** The version 1 hash, without the domain. Only for withdrawing from the version 1 pool. */
export const legacyExtDataHash = (e: ExtData): bigint => mod(bytesToBigInt(keccak(encodeExtData(e))), FIELD_SIZE);

export const claimDataHash = (domain: Domain, encryptedOutput: Uint8Array): bigint =>
  mod(bytesToBigInt(keccak(concatBytes(word(BigInt(domain.chainId)), addrWord(domain.contract), word(96n), encodeBytes(encryptedOutput)))), FIELD_SIZE);

/** publicAmount = extAmount - fee, mapped into the field (negative values wrap). */
export function publicAmount(extAmount: bigint, fee: bigint): bigint {
  return mod(extAmount - fee, FIELD_SIZE);
}

/** abi.encode(address assetOut, bytes32 ownerTag, uint256 batchId, bytes ciphertext) for ElysianSwap. */
export function encodeSwapAdapterData(
  assetOut: `0x${string}`,
  ownerTag: bigint,
  batchId: bigint,
  ciphertext: Uint8Array,
): Uint8Array {
  const enc = encodeBytes(ciphertext);
  return concatBytes(addrWord(assetOut), word(ownerTag), word(batchId), word(128n), enc);
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

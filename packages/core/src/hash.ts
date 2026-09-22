import { poseidon2, poseidon3, poseidon4, poseidon7 } from 'poseidon-lite';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { FIELD_SIZE, ZERO_LEAF_PREIMAGE } from './constants.js';
import { bytesToBigInt, mod } from './field.js';

export { poseidon2, poseidon3, poseidon4, poseidon7 };

export const keccak = (data: Uint8Array): Uint8Array => keccak_256(data);

/** keccak256 of the input, reduced into the scalar field. */
export const keccakToField = (data: Uint8Array): bigint => mod(bytesToBigInt(keccak_256(data)), FIELD_SIZE);

/** Value stored in every empty leaf: keccak256("elysian") mod p. */
export const ZERO_LEAF: bigint = keccakToField(new TextEncoder().encode(ZERO_LEAF_PREIMAGE));

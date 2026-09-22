/**
 * Key hierarchy (Orchard-inspired, simplified for a Poseidon/BN254 circuit):
 *
 *   sk  spending key            random field element, or derived from a wallet signature
 *   ak  spend authority         Poseidon(DOMAIN.AK, sk)
 *   nk  nullifier key           Poseidon(DOMAIN.NK, sk)
 *   pk  note owner              Poseidon(ak, nk)          -- lives inside every note commitment
 *   ek  encryption key (x25519) HKDF(sk, "elysian/enc/v1") -- decrypts note ciphertexts
 *
 * A full viewing key is (ak, nk, ek). It can scan, decrypt and detect spends of every note
 * owned by the account, but it cannot produce a spend proof because the circuit demands sk.
 * A shielded address is (pk, ek.pub): enough to build a note for someone and encrypt it to them.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { bech32m } from '@scure/base';
import { ADDRESS_HRP, DOMAIN, VIEWING_KEY_HRP } from './constants.js';
import { bigIntToBytes, bytesToBigInt, concatBytes, hexToBytes, mod, randomField } from './field.js';
import { keccakToField, poseidon2 } from './hash.js';

export interface ShieldedAddress {
  pk: bigint;
  encPub: Uint8Array; // 32 bytes
}

export interface FullViewingKey {
  ak: bigint;
  nk: bigint;
  encPriv: Uint8Array; // 32 bytes
}

export class SpendingKey {
  readonly sk: bigint;
  readonly ak: bigint;
  readonly nk: bigint;
  readonly pk: bigint;
  readonly encPriv: Uint8Array;
  readonly encPub: Uint8Array;

  constructor(sk: bigint) {
    this.sk = mod(sk);
    this.ak = poseidon2([DOMAIN.AK, this.sk]);
    this.nk = poseidon2([DOMAIN.NK, this.sk]);
    this.pk = poseidon2([this.ak, this.nk]);
    this.encPriv = hkdf(sha256, bigIntToBytes(this.sk, 32), undefined, utf8ToBytes('elysian/enc/v1'), 32);
    this.encPub = x25519.getPublicKey(this.encPriv);
  }

  static random(): SpendingKey {
    return new SpendingKey(randomField());
  }

  /** Derive from an EIP-191 wallet signature (65 bytes). Deterministic per wallet + chain. */
  static fromSignature(signature: Uint8Array | string): SpendingKey {
    const bytes = typeof signature === 'string' ? hexToBytes(signature) : signature;
    return new SpendingKey(keccakToField(bytes));
  }

  static fromHex(hex: string): SpendingKey {
    return new SpendingKey(BigInt(hex));
  }

  address(): ShieldedAddress {
    return { pk: this.pk, encPub: this.encPub };
  }

  viewingKey(): FullViewingKey {
    return { ak: this.ak, nk: this.nk, encPriv: this.encPriv };
  }

  toHex(): `0x${string}` {
    return `0x${this.sk.toString(16).padStart(64, '0')}` as `0x${string}`;
  }
}

/* ---------------------------------- encodings --------------------------------- */

const BECH32_LIMIT = 1024;

export function encodeAddress(addr: ShieldedAddress): string {
  const payload = concatBytes(bigIntToBytes(addr.pk, 32), addr.encPub);
  return bech32m.encode(ADDRESS_HRP, bech32m.toWords(payload), BECH32_LIMIT);
}

export function decodeAddress(encoded: string): ShieldedAddress {
  const { prefix, words } = bech32m.decode(encoded as `${string}1${string}`, BECH32_LIMIT);
  if (prefix !== ADDRESS_HRP) throw new Error('not a Elysian address');
  const bytes = bech32m.fromWords(words);
  if (bytes.length !== 64) throw new Error('malformed address');
  return { pk: bytesToBigInt(bytes.slice(0, 32)), encPub: bytes.slice(32, 64) };
}

export function isAddress(encoded: string): boolean {
  try {
    decodeAddress(encoded);
    return true;
  } catch {
    return false;
  }
}

export function encodeViewingKey(fvk: FullViewingKey): string {
  const payload = concatBytes(bigIntToBytes(fvk.ak, 32), bigIntToBytes(fvk.nk, 32), fvk.encPriv);
  return bech32m.encode(VIEWING_KEY_HRP, bech32m.toWords(payload), BECH32_LIMIT);
}

export function decodeViewingKey(encoded: string): FullViewingKey {
  const { prefix, words } = bech32m.decode(encoded as `${string}1${string}`, BECH32_LIMIT);
  if (prefix !== VIEWING_KEY_HRP) throw new Error('not a Elysian viewing key');
  const bytes = bech32m.fromWords(words);
  if (bytes.length !== 96) throw new Error('malformed viewing key');
  return {
    ak: bytesToBigInt(bytes.slice(0, 32)),
    nk: bytesToBigInt(bytes.slice(32, 64)),
    encPriv: bytes.slice(64, 96),
  };
}

/** The owner field of a note, derivable from a full viewing key. */
export const pkFromViewingKey = (fvk: FullViewingKey): bigint => poseidon2([fvk.ak, fvk.nk]);

/** Short display form: elysian1abcd…wxyz */
export function shortenAddress(encoded: string, head = 12, tail = 6): string {
  if (encoded.length <= head + tail + 1) return encoded;
  return `${encoded.slice(0, head)}…${encoded.slice(-tail)}`;
}

import { FIELD_SIZE } from './constants.js';

export const mod = (a: bigint, m: bigint = FIELD_SIZE): bigint => ((a % m) + m) % m;

export function randomField(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return mod(bytesToBigInt(bytes));
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export function bigIntToBytes(v: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = v;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x !== 0n) throw new Error('value does not fit');
  return out;
}

export const toHex32 = (v: bigint): `0x${string}` =>
  `0x${v.toString(16).padStart(64, '0')}` as `0x${string}`;

export const hexToBigInt = (hex: string): bigint => BigInt(hex.startsWith('0x') ? hex : `0x${hex}`);

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export const bytesToHex = (b: Uint8Array): `0x${string}` =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2) throw new Error('odd hex length');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

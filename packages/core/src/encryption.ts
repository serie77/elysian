/**
 * Note encryption: ephemeral x25519 -> HKDF-SHA256 -> XChaCha20-Poly1305.
 * Ciphertext layout: ephemeralPub(32) | nonce(24) | sealed
 * Only the holder of the recipient's encPriv can open it. Trial decryption is how wallets scan.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { concatBytes } from './field.js';

const INFO = 'elysian/note/v1';

function sharedKey(secret: Uint8Array, ephemeralPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  return hkdf(sha256, secret, concatBytes(ephemeralPub, recipientPub), utf8ToBytes(INFO), 32);
}

export function encryptTo(recipientPub: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const eph = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(eph);
  const secret = x25519.getSharedSecret(eph, recipientPub);
  const key = sharedKey(secret, ephPub, recipientPub);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const sealed = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return concatBytes(ephPub, nonce, sealed);
}

/** Returns null when the ciphertext is not addressed to this key. */
export function tryDecrypt(encPriv: Uint8Array, ciphertext: Uint8Array): Uint8Array | null {
  if (ciphertext.length < 32 + 24 + 16) return null;
  const ephPub = ciphertext.slice(0, 32);
  const nonce = ciphertext.slice(32, 56);
  const sealed = ciphertext.slice(56);
  try {
    const recipientPub = x25519.getPublicKey(encPriv);
    const secret = x25519.getSharedSecret(encPriv, ephPub);
    const key = sharedKey(secret, ephPub, recipientPub);
    return xchacha20poly1305(key, nonce).decrypt(sealed);
  } catch {
    return null;
  }
}

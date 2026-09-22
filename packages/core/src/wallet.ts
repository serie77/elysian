/**
 * Scanning: rebuild a shielded balance from the public commitment log.
 * Every NewCommitment carries a ciphertext. We trial-decrypt each one with our encryption key,
 * recompute the commitment with our pk, and keep the ones that match the on-chain leaf.
 * Spent detection compares our derived nullifiers against the on-chain nullifier set.
 */
import { tryDecrypt } from './encryption.js';
import type { SpendingKey, FullViewingKey } from './keys.js';
import { pkFromViewingKey } from './keys.js';
import { deserializeNote, noteCommitment, noteNullifier, type OwnedNote } from './note.js';
import { deserializeSwap, swapCommitment, swapNullifier, type OwnedSwap } from './swap.js';

export interface CommitmentRecord {
  commitment: bigint;
  index: number;
  ciphertext: Uint8Array;
}

export interface SwapRecord {
  commitment: bigint;
  index: number;
  batchId: bigint;
  assetIn: bigint;
  assetOut: bigint;
  amountIn: bigint;
  ciphertext: Uint8Array;
}

type Scanner = Pick<FullViewingKey, 'nk' | 'encPriv'> & { pk: bigint };

const scannerOf = (k: SpendingKey | FullViewingKey): Scanner =>
  'sk' in k ? { pk: k.pk, nk: k.nk, encPriv: k.encPriv } : { pk: pkFromViewingKey(k), nk: k.nk, encPriv: k.encPriv };

export function scanCommitments(key: SpendingKey | FullViewingKey, records: CommitmentRecord[]): OwnedNote[] {
  const me = scannerOf(key);
  const owned: OwnedNote[] = [];
  for (const r of records) {
    const plain = tryDecrypt(me.encPriv, r.ciphertext);
    if (!plain) continue;
    let parsed;
    try {
      parsed = deserializeNote(plain, me.pk);
    } catch {
      continue;
    }
    const commitment = noteCommitment(parsed.note);
    if (commitment !== r.commitment) continue;
    owned.push({
      ...parsed.note,
      commitment,
      leafIndex: r.index,
      nullifier: noteNullifier(commitment, r.index, me.nk),
      memo: parsed.memo || undefined,
    });
  }
  return owned;
}

export function scanSwaps(key: SpendingKey | FullViewingKey, records: SwapRecord[]): OwnedSwap[] {
  const me = scannerOf(key);
  const owned: OwnedSwap[] = [];
  for (const r of records) {
    const plain = tryDecrypt(me.encPriv, r.ciphertext);
    if (!plain) continue;
    let swap;
    try {
      swap = deserializeSwap(plain, me.pk);
    } catch {
      continue;
    }
    const commitment = swapCommitment(swap);
    if (commitment !== r.commitment) continue;
    owned.push({ ...swap, commitment, leafIndex: r.index, nullifier: swapNullifier(commitment, me.nk) });
  }
  return owned;
}

export interface Balance {
  asset: bigint;
  amount: bigint;
  notes: OwnedNote[];
}

export function balances(notes: OwnedNote[], spent: Set<bigint>): Balance[] {
  const byAsset = new Map<bigint, Balance>();
  for (const n of notes) {
    if (spent.has(n.nullifier) || n.amount === 0n) continue;
    const b = byAsset.get(n.asset) ?? { asset: n.asset, amount: 0n, notes: [] };
    b.amount += n.amount;
    b.notes.push(n);
    byAsset.set(n.asset, b);
  }
  return [...byAsset.values()];
}

/** Pick up to two unspent notes covering `amount`: largest first, so change stays small. */
export function selectNotes(notes: OwnedNote[], amount: bigint): OwnedNote[] {
  const sorted = [...notes].sort((a, b) => (a.amount > b.amount ? -1 : 1));
  if (sorted.length && sorted[0].amount >= amount) {
    const exact = sorted.find((n) => n.amount === amount);
    return [exact ?? sorted[0]];
  }
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i].amount + sorted[j].amount >= amount) return [sorted[i], sorted[j]];
    }
  }
  throw new Error('insufficient shielded balance in at most two notes; consolidate first');
}

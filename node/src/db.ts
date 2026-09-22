import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, `elysian-${config.chainId}.sqlite`));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS commitments (
    idx INTEGER PRIMARY KEY,
    commitment TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    block INTEGER NOT NULL,
    tx TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS nullifiers (
    nullifier TEXT PRIMARY KEY,
    block INTEGER NOT NULL,
    tx TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS swaps (
    idx INTEGER PRIMARY KEY,
    commitment TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    asset_in TEXT NOT NULL,
    asset_out TEXT NOT NULL,
    amount_in TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    block INTEGER NOT NULL,
    tx TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS batches (
    asset_in TEXT NOT NULL,
    asset_out TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    total_in TEXT NOT NULL DEFAULT '0',
    total_out TEXT NOT NULL DEFAULT '0',
    executed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (asset_in, asset_out, batch_id)
  );
  CREATE TABLE IF NOT EXISTS claims (
    nullifier TEXT PRIMARY KEY,
    output_commitment TEXT NOT NULL,
    block INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    asset TEXT,
    amount TEXT,
    block INTEGER NOT NULL,
    tx TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
`);

// Added after the first release; older databases get the column on start.
if (!(db.prepare('PRAGMA table_info(batches)').all() as { name: string }[]).some((c) => c.name === 'refunded')) {
  db.exec('ALTER TABLE batches ADD COLUMN refunded INTEGER NOT NULL DEFAULT 0');
}

export const meta = {
  get(key: string): string | undefined {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  },
  set(key: string, value: string) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  },
};

export interface CommitmentRow {
  idx: number;
  commitment: string;
  ciphertext: string;
  block: number;
  tx: string;
}
export interface SwapRow {
  idx: number;
  commitment: string;
  batch_id: string;
  asset_in: string;
  asset_out: string;
  amount_in: string;
  ciphertext: string;
  block: number;
  tx: string;
}
export interface BatchRow {
  asset_in: string;
  asset_out: string;
  batch_id: string;
  total_in: string;
  total_out: string;
  executed: number;
  refunded: number;
}

export const q = {
  insertCommitment: db.prepare('INSERT OR IGNORE INTO commitments (idx, commitment, ciphertext, block, tx) VALUES (?, ?, ?, ?, ?)'),
  insertNullifier: db.prepare('INSERT OR IGNORE INTO nullifiers (nullifier, block, tx) VALUES (?, ?, ?)'),
  insertSwap: db.prepare(
    'INSERT OR IGNORE INTO swaps (idx, commitment, batch_id, asset_in, asset_out, amount_in, ciphertext, block, tx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ),
  upsertBatchIn: db.prepare(`
    INSERT INTO batches (asset_in, asset_out, batch_id, total_in) VALUES (?, ?, ?, ?)
    ON CONFLICT(asset_in, asset_out, batch_id) DO UPDATE SET total_in = excluded.total_in`),
  executeBatch: db.prepare('UPDATE batches SET total_in = ?, total_out = ?, executed = 1 WHERE asset_in = ? AND asset_out = ? AND batch_id = ?'),
  refundBatch: db.prepare('UPDATE batches SET total_out = total_in, executed = 1, refunded = 1 WHERE asset_in = ? AND asset_out = ? AND batch_id = ?'),
  insertClaim: db.prepare('INSERT OR IGNORE INTO claims (nullifier, output_commitment, block) VALUES (?, ?, ?)'),
  insertActivity: db.prepare('INSERT INTO activity (kind, asset, amount, block, tx, ts) VALUES (?, ?, ?, ?, ?, ?)'),
  commitmentsFrom: db.prepare('SELECT * FROM commitments WHERE idx >= ? ORDER BY idx LIMIT ?'),
  allCommitments: db.prepare('SELECT commitment FROM commitments ORDER BY idx'),
  nullifiersFrom: db.prepare('SELECT nullifier, block FROM nullifiers WHERE block >= ? ORDER BY block'),
  allNullifiers: db.prepare('SELECT nullifier FROM nullifiers'),
  allClaims: db.prepare('SELECT nullifier FROM claims'),
  swapsFrom: db.prepare('SELECT * FROM swaps WHERE idx >= ? ORDER BY idx LIMIT ?'),
  allSwaps: db.prepare('SELECT commitment FROM swaps ORDER BY idx'),
  pendingBatches: db.prepare('SELECT * FROM batches WHERE executed = 0 AND CAST(batch_id AS INTEGER) < ?'),
  batchesFor: db.prepare('SELECT * FROM batches WHERE asset_in = ? AND asset_out = ? ORDER BY CAST(batch_id AS INTEGER) DESC LIMIT 50'),
  recentBatches: db.prepare('SELECT * FROM batches ORDER BY CAST(batch_id AS INTEGER) DESC LIMIT ?'),
  batchesPage: db.prepare('SELECT * FROM batches ORDER BY CAST(batch_id AS INTEGER) DESC LIMIT ? OFFSET ?'),
  recentActivity: db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?'),
  counts: db.prepare(
    'SELECT (SELECT COUNT(*) FROM commitments) AS commitments, (SELECT COUNT(*) FROM nullifiers) AS nullifiers, (SELECT COUNT(*) FROM swaps) AS swaps, (SELECT COUNT(*) FROM batches WHERE executed = 1) AS batches',
  ),
};

/**
 * Freezes six real Robinhood Chain transfers into src/lib/chain-transfers.json. The landing page
 * renders these first and swaps in live ones once the browser has fetched them.
 *
 *   npx tsx web/scripts/snapshot-transfers.mts
 */
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { upstream } from '../src/lib/server/upstream';
import { recentTransfers } from '../src/lib/transfers';

const env = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);
const { block, rows } = await recentTransfers(upstream(4663)!);
if (rows.length < 6) throw new Error(`only ${rows.length} transfers found`);
const out = fileURLToPath(new URL('../src/lib/chain-transfers.json', import.meta.url));
writeFileSync(out, JSON.stringify({ block, rows }, null, 2) + '\n');
console.log(`block ${block}`);
for (const r of rows) console.log(`${r.token.padEnd(5)} ${r.amount.padStart(14)}  ${r.from} -> ${r.to}  ${r.hash}`);

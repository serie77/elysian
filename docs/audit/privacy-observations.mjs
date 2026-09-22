// Read-only audit: public data from the already-running mainnet node and explorer.
// Run from the repository root: node docs/audit/privacy-observations.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { SpendingKey, createNote, serializeNote, encryptTo } from '../../packages/core/dist/index.js';

const base = 'http://127.0.0.1:8788';
const get = async (p) => {
  const r = await fetch(base + p, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};
const [summary, batches, txs, state] = await Promise.all([
  get('/explorer/summary'), get('/explorer/batches?limit=100'), get('/explorer/txs?limit=100'), get('/state'),
]);
const details = [];
for (const t of txs.rows.filter(t => ['swap', 'claim'].includes(t.kind))) {
  details.push(await get(`/explorer/tx/${t.tx}`));
}
const headerResponse = await fetch('http://localhost:3002/explorer/view', { method: 'HEAD' });
const key = SpendingKey.random();
const note = createNote(1n, 1n, key.pk);
const memoLengths = ['', 'hello', 'x'.repeat(128)].map(memo => ({
  memoBytes: new TextEncoder().encode(memo).length,
  ciphertextBytes: encryptTo(key.encPub, serializeNote(note, memo)).length,
}));
const deployment = JSON.parse(readFileSync('contracts/deployments/robinhood.json', 'utf8'));
const verifierChecks = [];
for (const [field, name] of [['transactionVerifier', 'TransactionVerifier'], ['swapClaimVerifier', 'SwapClaimVerifier']]) {
  const res = await fetch('http://localhost:3002/api/rpc/4663', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [deployment[field], 'latest'] }),
  });
  const response = await res.json();
  const artifact = JSON.parse(readFileSync(`contracts/artifacts/contracts/verifiers/${name}.sol/${name}.json`, 'utf8'));
  verifierChecks.push({ name, address: deployment[field], exactRuntimeMatch: response.result === artifact.deployedBytecode, rpcError: response.error ?? null });
}
const result = {
  capturedAt: new Date().toISOString(), source: base, summary,
  relayer: state.relayer, batches,
  analyzedTransactionCount: txs.rows.length, totalIndexedTransactions: txs.total,
  swaps: details.filter(d => d.kind === 'swap').map(d => ({ hash: d.tx, from: d.from, relayer: d.relayer, batchId: d.batchId, amount: d.amount, symbol: d.asset?.symbol })),
  claims: details.filter(d => d.kind === 'claim').map(d => ({ hash: d.tx, from: d.from, batchId: d.batchId, reportedAmount: d.amount, orders: d.batch?.orders, inferablePayoutRaw: d.batch?.orders === 1 ? d.batch.totalOut : null, outputCommitments: d.commitments })),
  localExplorerHeaders: Object.fromEntries(headerResponse.headers), memoLengths, verifierChecks,
};
writeFileSync(new URL('./privacy-observations.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ capturedAt: result.capturedAt, transactions: txs.total, notes: summary.totals.notes, singletonBatches: batches.rows.filter(b => b.orders === 1).length, totalBatches: batches.total, swaps: result.swaps, claims: result.claims, memoLengths, verifierChecks }, null, 2));

/**
 * Explorer API. Rebuilt from what the indexer stores plus each transaction's public calldata and
 * receipt: the complete list of what an outsider can learn about Elysian, and nothing more.
 */
import type { FastifyInstance } from 'fastify';
import { decodeEventLog, decodeFunctionData, parseAbi, type Hex } from 'viem';
import { erc20Abi, poolAbi, swapAbi } from './abi.js';
import { publicClient, relayer } from './chain.js';
import { config } from './config.js';
import { db } from './db.js';
import { poolTree, status, swapTree } from './indexer.js';

type Kind = 'shield' | 'unshield' | 'transfer' | 'swap' | 'batch' | 'claim';

db.exec('CREATE TABLE IF NOT EXISTS tx_meta (tx TEXT PRIMARY KEY, json TEXT NOT NULL)');

const ALL_TX = 'SELECT tx, block FROM commitments UNION SELECT tx, block FROM nullifiers UNION SELECT tx, block FROM activity UNION SELECT tx, block FROM swaps';
const txPage = db.prepare(`SELECT tx, block FROM (${ALL_TX}) GROUP BY tx ORDER BY block DESC, tx LIMIT ? OFFSET ?`);
const txCount = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT tx FROM (${ALL_TX}))`);
const oneTx = db.prepare(`SELECT tx, block FROM (${ALL_TX}) WHERE tx = ? LIMIT 1`);
const txCommitments = db.prepare('SELECT idx, commitment, LENGTH(ciphertext) AS size FROM commitments WHERE tx = ? ORDER BY idx');
const txNullifiers = db.prepare('SELECT nullifier FROM nullifiers WHERE tx = ?');
const txSwaps = db.prepare('SELECT idx, commitment, batch_id, asset_in, asset_out, amount_in FROM swaps WHERE tx = ?');
const txActivity = db.prepare('SELECT kind, asset, amount FROM activity WHERE tx = ? ORDER BY id');
const find = db.prepare(`SELECT tx FROM commitments WHERE commitment = ? UNION SELECT tx FROM nullifiers WHERE nullifier = ? UNION SELECT tx FROM swaps WHERE commitment = ?
  UNION SELECT c.tx FROM claims k JOIN commitments c ON c.commitment = k.output_commitment WHERE k.nullifier = ? LIMIT 1`);
const assetsSeen = db.prepare('SELECT DISTINCT asset FROM activity WHERE asset IS NOT NULL');
const totals = db.prepare(`
  SELECT (SELECT COUNT(*) FROM commitments) AS notes, (SELECT COUNT(*) FROM nullifiers) AS spent,
    (SELECT COUNT(*) FROM swaps) AS intents, (SELECT COUNT(*) FROM batches WHERE executed = 1) AS batches,
    (SELECT COUNT(*) FROM claims) AS claims
`);
const getMeta = db.prepare('SELECT json FROM tx_meta WHERE tx = ?');
const putMeta = db.prepare('INSERT OR REPLACE INTO tx_meta (tx, json) VALUES (?, ?)');

const stamps = new Map<number, number>();
async function stamp(block: number): Promise<number> {
  let ts = stamps.get(block);
  if (ts === undefined) {
    ts = Number((await publicClient.getBlock({ blockNumber: BigInt(block) })).timestamp);
    stamps.set(block, ts);
  }
  return ts;
}

const tokenMeta = new Map<string, { symbol: string; decimals: number }>();
async function token(address: string) {
  const key = address.toLowerCase();
  let m = tokenMeta.get(key);
  if (!m) {
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({ address: key as Hex, abi: erc20Abi, functionName: 'symbol' }),
      publicClient.readContract({ address: key as Hex, abi: erc20Abi, functionName: 'decimals' }),
    ]);
    m = { symbol, decimals: Number(decimals) };
    tokenMeta.set(key, m);
  }
  return { address: key, ...m };
}

const label = (address: string | null | undefined): string | null => {
  const a = address?.toLowerCase();
  return a === config.pool.toLowerCase() ? 'Elysian: Pool' : a === config.swap.toLowerCase() ? 'Elysian: Swap' : a === config.dex?.toLowerCase() ? 'Elysian: Venue Adapter' : null;
};

/** Everything public about one transaction that never changes once mined. Cached in sqlite. */
interface Meta {
  block: number;
  ts: number;
  from: string;
  to: string | null;
  status: 'success' | 'reverted';
  nonce: number;
  position: number;
  gasUsed: string;
  gasLimit: string;
  gasPrice: string;
  fee: string;
  selector: string;
  inputSize: number;
  kind: Kind;
  method: string;
  asset: string | null;
  assetOut: string | null;
  amount: string | null;
  recipient: string | null;
  relayer: string | null;
  relayerFee: string | null;
  root: string | null;
  extDataHash: string | null;
  batchId: string | null;
  minOut: string | null;
}

const METHOD: Record<Kind, string> = { shield: 'Shield', unshield: 'Unshield', transfer: 'Private Transfer', swap: 'Sealed Order', batch: 'Execute Batch', claim: 'Claim' };
const zeroAddr = (a: string) => /^0x0+$/.test(a);

async function meta(hash: Hex, block: number): Promise<Meta> {
  const hit = getMeta.get(hash) as { json: string } | undefined;
  if (hit) return JSON.parse(hit.json) as Meta;
  const [onchain, receipt, ts] = await Promise.all([publicClient.getTransaction({ hash }), publicClient.getTransactionReceipt({ hash }), stamp(block)]);
  const m: Meta = {
    block,
    ts,
    from: onchain.from,
    to: onchain.to,
    status: receipt.status,
    nonce: onchain.nonce,
    position: receipt.transactionIndex,
    gasUsed: receipt.gasUsed.toString(),
    gasLimit: onchain.gas.toString(),
    gasPrice: receipt.effectiveGasPrice.toString(),
    fee: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    selector: onchain.input.slice(0, 10),
    inputSize: (onchain.input.length - 2) / 2,
    kind: 'transfer',
    method: '',
    asset: null,
    assetOut: null,
    amount: null,
    recipient: null,
    relayer: null,
    relayerFee: null,
    root: null,
    extDataHash: null,
    batchId: null,
    minOut: null,
  };
  try {
    if (onchain.to?.toLowerCase() === config.pool.toLowerCase()) {
      const [proof, ext] = decodeFunctionData({ abi: poolAbi, data: onchain.input }).args as unknown as [
        { root: Hex; assetId: bigint; extDataHash: Hex },
        { recipient: Hex; extAmount: bigint; relayer: Hex; fee: bigint },
      ];
      m.asset = `0x${proof.assetId.toString(16).padStart(40, '0')}`;
      m.root = proof.root;
      m.extDataHash = proof.extDataHash;
      m.relayer = zeroAddr(ext.relayer) ? null : ext.relayer;
      m.relayerFee = ext.fee === 0n ? null : ext.fee.toString();
      if (ext.extAmount > 0n) {
        m.kind = 'shield';
        m.amount = ext.extAmount.toString();
      } else if (ext.extAmount < 0n) {
        m.kind = ext.recipient.toLowerCase() === config.swap.toLowerCase() ? 'swap' : 'unshield';
        m.amount = (-ext.extAmount).toString();
        m.recipient = ext.recipient;
      }
      const intent = (txSwaps.all(hash) as { batch_id: string; asset_out: string }[])[0];
      if (intent) {
        m.batchId = intent.batch_id;
        m.assetOut = intent.asset_out;
      }
    } else if (onchain.to?.toLowerCase() === config.swap.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: swapAbi, data: onchain.input });
      if (functionName === 'claim') {
        const [c] = args as unknown as [{ swapRoot: Hex; batchId: bigint; assetIn: Hex; assetOut: Hex }];
        // A cancelled batch pays its claims back in the asset they sold.
        const b = db.prepare('SELECT refunded FROM batches WHERE asset_in = ? AND asset_out = ? AND batch_id = ?').get(c.assetIn.toLowerCase(), c.assetOut.toLowerCase(), c.batchId.toString()) as { refunded: number } | undefined;
        Object.assign(m, { kind: 'claim', asset: (b?.refunded ? c.assetIn : c.assetOut).toLowerCase(), batchId: c.batchId.toString(), root: c.swapRoot });
      } else if (functionName === 'executeBatch') {
        const [assetIn, assetOut, batchId, minOut] = args as unknown as [Hex, Hex, bigint, bigint];
        const b = db.prepare('SELECT total_in FROM batches WHERE asset_in = ? AND asset_out = ? AND batch_id = ?').get(assetIn.toLowerCase(), assetOut.toLowerCase(), batchId.toString()) as { total_in: string } | undefined;
        Object.assign(m, { kind: 'batch', asset: assetIn.toLowerCase(), assetOut: assetOut.toLowerCase(), batchId: batchId.toString(), minOut: minOut.toString(), amount: b?.total_in ?? null });
      } else if (functionName === 'cancelBatch') {
        const [assetIn, assetOut, batchId] = args as unknown as [Hex, Hex, bigint];
        const b = db.prepare('SELECT total_in FROM batches WHERE asset_in = ? AND asset_out = ? AND batch_id = ?').get(assetIn.toLowerCase(), assetOut.toLowerCase(), batchId.toString()) as { total_in: string } | undefined;
        Object.assign(m, { kind: 'batch', method: 'Cancel Batch', asset: assetIn.toLowerCase(), assetOut: assetOut.toLowerCase(), batchId: batchId.toString(), amount: b?.total_in ?? null });
      }
    }
  } catch {
    // Reached the contracts through a wrapper: fall back to what the events say.
    const a = (txActivity.all(hash) as { kind: Kind; asset: string; amount: string }[])[0];
    if (a) Object.assign(m, { kind: a.kind, asset: a.asset.split(':')[0], amount: a.amount });
  }
  m.method ||= METHOD[m.kind];
  putMeta.run(hash, JSON.stringify(m));
  return m;
}

async function row(tx: Hex, block: number) {
  const m = await meta(tx, block);
  return {
    tx,
    block: m.block,
    ts: m.ts,
    kind: m.kind,
    method: m.method,
    status: m.status,
    from: m.from,
    // Unrelayed: the signer is not a relayer this node knows, so it may be the owner's own wallet; the address alone cannot say.
    // Claims name no relayer in calldata, so this node's own relayer account is recognised by address.
    fromLabel:
      (m.relayer && m.relayer.toLowerCase() === m.from.toLowerCase()) || (relayer && relayer.account.address.toLowerCase() === m.from.toLowerCase())
        ? 'Relayer'
        : m.kind === 'batch'
          ? 'Executor'
          : m.kind === 'shield'
            ? 'Depositor'
            : 'Unrelayed',
    to: m.to,
    toLabel: label(m.to),
    asset: m.asset && !zeroAddr(m.asset) ? await token(m.asset) : null,
    assetOut: m.assetOut ? await token(m.assetOut) : null,
    amount: m.amount,
    fee: m.fee,
  };
}

const EVENTS = [...poolAbi, ...swapAbi, ...parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)', 'event Approval(address indexed owner, address indexed spender, uint256 value)'])];
const plain = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(plain) : v);

let pooled: { at: number; rows: unknown[] } | undefined;

export function registerExplorer(app: FastifyInstance) {
  app.get('/explorer/summary', async () => {
    if (!pooled || Date.now() - pooled.at > 8000) {
      const assets = [...new Set((assetsSeen.all() as { asset: string }[]).flatMap((a) => a.asset.split(':')))];
      const rows = await Promise.all(
        assets.map(async (asset) => ({
          ...(await token(asset)),
          balance: (await publicClient.readContract({ address: asset as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [config.pool] })).toString(),
        })),
      );
      pooled = { at: Date.now(), rows: rows.filter((r) => r.balance !== '0') };
    }
    const s = status();
    const head = await publicClient.getBlock();
    return {
      chainId: config.chainId,
      contracts: { pool: config.pool, swap: config.swap, dex: config.dex },
      head: Number(head.number),
      indexed: s.lastBlock,
      chainTime: Number(head.timestamp),
      batchDuration: config.batchDuration,
      currentBatch: (head.timestamp / BigInt(config.batchDuration)).toString(),
      poolRoot: `0x${poolTree.root.toString(16).padStart(64, '0')}`,
      swapRoot: `0x${swapTree.root.toString(16).padStart(64, '0')}`,
      totals: totals.get(),
      transactions: (txCount.get() as { n: number }).n,
      pooled: pooled.rows,
    };
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/explorer/txs', async (req) => {
    const rows = txPage.all(Math.min(Number(req.query.limit ?? 25), 100), Number(req.query.offset ?? 0)) as { tx: Hex; block: number }[];
    return { total: (txCount.get() as { n: number }).n, rows: await Promise.all(rows.map((r) => row(r.tx, r.block))) };
  });

  app.get<{ Params: { hash: string } }>('/explorer/tx/:hash', async (req, reply) => {
    const hash = req.params.hash.toLowerCase() as Hex;
    const known = oneTx.get(hash) as { tx: Hex; block: number } | undefined;
    if (!known) return reply.code(404).send({ error: 'Transaction not found' });
    const [m, summary, onchain, receipt, head] = await Promise.all([meta(hash, known.block), row(hash, known.block), publicClient.getTransaction({ hash }), publicClient.getTransactionReceipt({ hash }), publicClient.getBlockNumber()]);
    const logs = await Promise.all(
      receipt.logs.map(async (log) => {
        let name: string | null = null;
        let args: Record<string, unknown> = {};
        try {
          const d = decodeEventLog({ abi: EVENTS, data: log.data, topics: log.topics });
          name = d.eventName;
          args = Object.fromEntries(Object.entries(d.args as unknown as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' && v.length > 140 ? `${v.slice(0, 66)}… (${(v.length - 2) / 2} bytes)` : plain(v)]));
        } catch {
          // an event from a contract we do not know; shown raw
        }
        return { index: log.logIndex, address: log.address, label: label(log.address), name, args, topics: log.topics };
      }),
    );
    const transfers = await Promise.all(
      logs.filter((l) => l.name === 'Transfer').map(async (l) => ({ token: await token(l.address), from: l.args.from as string, fromLabel: label(l.args.from as string), to: l.args.to as string, toLabel: label(l.args.to as string), value: l.args.value as string })),
    );
    const swaps = txSwaps.all(hash) as { idx: number; commitment: string; batch_id: string; asset_in: string; asset_out: string; amount_in: string }[];

    // The batch this transaction belongs to: the order it placed, the batch it cleared, or the one it claims from.
    let pair: [string, string] | null = m.batchId && m.asset && m.assetOut ? [m.asset, m.assetOut] : null;
    if (m.kind === 'claim') {
      try {
        const [c] = decodeFunctionData({ abi: swapAbi, data: onchain.input }).args as unknown as [{ assetIn: Hex; assetOut: Hex }];
        pair = [c.assetIn.toLowerCase(), c.assetOut.toLowerCase()];
      } catch {
        pair = null;
      }
    }
    const b = pair && m.batchId ? (db.prepare('SELECT total_in, total_out, executed, refunded FROM batches WHERE asset_in = ? AND asset_out = ? AND batch_id = ?').get(pair[0], pair[1], m.batchId) as { total_in: string; total_out: string; executed: number; refunded: number } | undefined) : undefined;
    const batch = b && pair
      ? {
          assetIn: await token(pair[0]),
          assetOut: await token(pair[1]),
          totalIn: b.total_in,
          totalOut: b.total_out,
          executed: !!b.executed,
          refunded: !!b.refunded,
          orders: (db.prepare('SELECT COUNT(*) AS n FROM swaps WHERE batch_id = ? AND asset_in = ? AND asset_out = ?').get(m.batchId, pair[0], pair[1]) as { n: number }).n,
        }
      : null;

    return {
      ...summary,
      batch,
      confirmations: Number(head) - known.block + 1,
      nonce: m.nonce,
      position: m.position,
      gasUsed: m.gasUsed,
      gasLimit: m.gasLimit,
      gasPrice: m.gasPrice,
      selector: m.selector,
      input: onchain.input.length > 2050 ? `${onchain.input.slice(0, 2050)}…` : onchain.input,
      inputSize: m.inputSize,
      recipient: m.recipient,
      relayer: m.relayer,
      relayerFee: m.relayerFee,
      root: m.root,
      extDataHash: m.extDataHash,
      batchId: m.batchId,
      minOut: m.minOut,
      nullifiers: (txNullifiers.all(hash) as { nullifier: string }[]).map((n) => n.nullifier),
      commitments: txCommitments.all(hash),
      intents: await Promise.all(swaps.map(async (s) => ({ index: s.idx, commitment: s.commitment, batchId: s.batch_id, assetIn: await token(s.asset_in), assetOut: await token(s.asset_out), amountIn: s.amount_in }))),
      transfers,
      logs,
    };
  });

  app.get<{ Params: { value: string } }>('/explorer/find/:value', async (req, reply) => {
    const v = req.params.value.toLowerCase();
    const hit = find.get(v, v, v, v) as { tx: string } | undefined;
    return hit ?? reply.code(404).send({ error: 'Nothing found' });
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/explorer/batches', async (req) => {
    const rows = db.prepare('SELECT * FROM batches ORDER BY CAST(batch_id AS INTEGER) DESC LIMIT ? OFFSET ?').all(Math.min(Number(req.query.limit ?? 25), 100), Number(req.query.offset ?? 0)) as { asset_in: string; asset_out: string; batch_id: string; total_in: string; total_out: string; executed: number; refunded: number }[];
    const executions = db.prepare("SELECT tx, block FROM activity WHERE kind = 'batch' AND asset = ?");
    return {
      total: (db.prepare('SELECT COUNT(*) AS n FROM batches').get() as { n: number }).n,
      rows: await Promise.all(
        rows.map(async (b) => {
          const candidates = executions.all(`${b.asset_in}:${b.asset_out}`) as { tx: Hex; block: number }[];
          const metas = await Promise.all(candidates.map(async (c) => ({ c, m: await meta(c.tx, c.block) })));
          const exec = metas.find((x) => x.m.batchId === b.batch_id);
          return {
            batchId: b.batch_id,
            opens: Number(b.batch_id) * config.batchDuration,
            assetIn: await token(b.asset_in),
            assetOut: await token(b.asset_out),
            totalIn: b.total_in,
            totalOut: b.total_out,
            executed: !!b.executed,
            refunded: !!b.refunded,
            orders: (db.prepare('SELECT COUNT(*) AS n FROM swaps WHERE batch_id = ? AND asset_in = ? AND asset_out = ?').get(b.batch_id, b.asset_in, b.asset_out) as { n: number }).n,
            tx: exec?.c.tx ?? null,
            executedAt: exec?.m.ts ?? null,
          };
        }),
      ),
    };
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/explorer/notes', async (req) => ({
    total: (db.prepare('SELECT COUNT(*) AS n FROM commitments').get() as { n: number }).n,
    rows: db.prepare('SELECT idx, commitment, LENGTH(ciphertext) AS size, block, tx FROM commitments ORDER BY idx DESC LIMIT ? OFFSET ?').all(Math.min(Number(req.query.limit ?? 25), 100), Number(req.query.offset ?? 0)),
  }));

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/explorer/nullifiers', async (req) => ({
    total: (db.prepare('SELECT COUNT(*) AS n FROM nullifiers').get() as { n: number }).n,
    rows: db.prepare('SELECT nullifier, block, tx FROM nullifiers ORDER BY block DESC LIMIT ? OFFSET ?').all(Math.min(Number(req.query.limit ?? 25), 100), Number(req.query.offset ?? 0)),
  }));
}

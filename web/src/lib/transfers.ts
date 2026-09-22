import { FEATURED, MAINNET_BASE, STOCK_TOKENS, formatAmount, type Asset } from './assets';

export const EXPLORER = 'https://robin.etherscan.io';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO = `0x${'0'.repeat(40)}`;

/** A real ERC-20 transfer on Robinhood Chain mainnet, exactly as any explorer shows it. */
export interface ChainTransfer {
  hash: string;
  block: number;
  from: string;
  to: string;
  amount: string;
  token: string;
}

export interface TransferFeed {
  block: number;
  rows: ChainTransfer[];
}

interface Log {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

const hex = (n: number) => `0x${n.toString(16)}`;

function logs(url: string, tokens: Asset[], from: number, to: number): Promise<Log[]> {
  return rpc<Log[]>(url, 'eth_getLogs', [{ address: tokens.map((t) => t.address), topics: [TRANSFER], fromBlock: hex(from), toBlock: hex(to) }]);
}

/**
 * The newest transfers across the featured stock tokens, USDG and WETH: one row per transaction,
 * one per token while there is variety to be had. Blocks are 100 ms, and USDG and WETH move
 * roughly fifty times as often as any stock, so they get a much shorter window. Runs on the
 * server (the RPC url carries a key); the browser reads the result from /api/transfers.
 */
export async function recentTransfers(url: string, count = 6): Promise<TransferFeed> {
  const head = Number(await rpc<string>(url, 'eth_blockNumber', []));
  const stocks = STOCK_TOKENS.filter((t) => FEATURED.includes(t.symbol));
  const found = (await Promise.all([logs(url, stocks, head - 400, head), logs(url, MAINNET_BASE, head - 20, head)])).flat();
  const bySymbol = new Map([...stocks, ...MAINNET_BASE].map((t) => [t.address.toLowerCase(), t]));

  const all: ChainTransfer[] = [];
  for (const log of found) {
    const asset = bySymbol.get(log.address.toLowerCase());
    if (!asset || log.topics.length !== 3) continue;
    const from = `0x${log.topics[1].slice(26)}`;
    const to = `0x${log.topics[2].slice(26)}`;
    const amount = formatAmount(BigInt(log.data), asset.decimals);
    if (from === ZERO || to === ZERO || amount === '0') continue;
    all.push({ hash: log.transactionHash, block: Number(log.blockNumber), from, to, amount, token: asset.symbol });
  }
  all.sort((a, b) => b.block - a.block);

  const rows: ChainTransfer[] = [];
  const hashes = new Set<string>();
  for (const perToken of [1, count]) {
    for (const t of all) {
      if (rows.length === count) break;
      if (hashes.has(t.hash) || rows.filter((r) => r.token === t.token).length >= perToken) continue;
      hashes.add(t.hash);
      rows.push(t);
    }
  }
  return { block: head, rows };
}

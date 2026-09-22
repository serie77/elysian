/** Client for the node's explorer API: the complete public record of the protocol, and nothing else. */
import { NODE_URL } from './deployments';

export type TxKind = 'shield' | 'unshield' | 'transfer' | 'swap' | 'batch' | 'claim';

export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
}

export interface Summary {
  chainId: number;
  contracts: { pool: string; swap: string; dex: string };
  head: number;
  indexed: number;
  chainTime: number;
  batchDuration: number;
  currentBatch: string;
  poolRoot: string;
  swapRoot: string;
  transactions: number;
  totals: { notes: number; spent: number; intents: number; batches: number; claims: number };
  pooled: (TokenRef & { balance: string })[];
}

export interface TxRow {
  tx: `0x${string}`;
  block: number;
  ts: number;
  kind: TxKind;
  method: string;
  status: 'success' | 'reverted';
  from: string;
  fromLabel: string | null;
  to: string | null;
  toLabel: string | null;
  asset: TokenRef | null;
  assetOut: TokenRef | null;
  amount: string | null;
  fee: string;
}

export interface TxLog {
  index: number;
  address: string;
  label: string | null;
  name: string | null;
  args: Record<string, unknown>;
  topics: string[];
}

export interface TxDetail extends TxRow {
  confirmations: number;
  nonce: number;
  position: number;
  gasUsed: string;
  gasLimit: string;
  gasPrice: string;
  selector: string;
  input: string;
  inputSize: number;
  recipient: string | null;
  relayer: string | null;
  relayerFee: string | null;
  root: string | null;
  extDataHash: string | null;
  batchId: string | null;
  batch: { assetIn: TokenRef; assetOut: TokenRef; totalIn: string; totalOut: string; executed: boolean; refunded: boolean; orders: number } | null;
  minOut: string | null;
  nullifiers: string[];
  commitments: { idx: number; commitment: string; size: number }[];
  intents: { index: number; commitment: string; batchId: string; assetIn: TokenRef; assetOut: TokenRef; amountIn: string }[];
  transfers: { token: TokenRef; from: string; fromLabel: string | null; to: string; toLabel: string | null; value: string }[];
  logs: TxLog[];
}

export interface BatchRow {
  batchId: string;
  opens: number;
  assetIn: TokenRef;
  assetOut: TokenRef;
  totalIn: string;
  totalOut: string;
  executed: boolean;
  refunded: boolean;
  orders: number;
  tx: `0x${string}` | null;
  executedAt: number | null;
}

export interface NoteRow {
  idx: number;
  commitment: string;
  size: number;
  block: number;
  tx: `0x${string}`;
}

export interface NullifierRow {
  nullifier: string;
  block: number;
  tx: `0x${string}`;
}

interface Page<T> {
  total: number;
  rows: T[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : 'Explorer unavailable');
  return (await res.json()) as T;
}

const page = (limit: number, offset: number) => `limit=${limit}&offset=${offset}`;

export const explorerApi = {
  summary: () => get<Summary>('/explorer/summary'),
  txs: (limit = 25, offset = 0) => get<Page<TxRow>>(`/explorer/txs?${page(limit, offset)}`),
  tx: (hash: string) => get<TxDetail>(`/explorer/tx/${hash}`),
  find: (value: string) => get<{ tx: `0x${string}` }>(`/explorer/find/${value}`),
  batches: (limit = 25, offset = 0) => get<Page<BatchRow>>(`/explorer/batches?${page(limit, offset)}`),
  notes: (limit = 25, offset = 0) => get<Page<NoteRow>>(`/explorer/notes?${page(limit, offset)}`),
  nullifiers: (limit = 25, offset = 0) => get<Page<NullifierRow>>(`/explorer/nullifiers?${page(limit, offset)}`),
};

export function age(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return `${s} secs ago`;
  if (s < 3600) return `${Math.floor(s / 60)} mins ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hrs ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

/** Wei to a trimmed ETH string. */
export function eth(wei: string, digits = 8): string {
  const v = BigInt(wei);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const gwei = (wei: string) => (Number(BigInt(wei)) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 4 });

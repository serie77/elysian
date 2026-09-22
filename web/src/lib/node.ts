/**
 * Client for the Elysian node: commitment log, ciphertexts, relaying. Wallets build their own tree paths.
 */
import { NODE_URL } from './deployments';

export interface NodeState {
  chainId: number;
  pool: `0x${string}`;
  swap: `0x${string}`;
  dex: `0x${string}`;
  batchDuration: number;
  currentBatch: string;
  chainTime?: number;
  lastBlock: number;
  poolRoot: `0x${string}`;
  swapRoot: `0x${string}`;
  poolLeaves: number;
  swapLeaves: number;
  relayer: `0x${string}` | null;
  relayFeeBps: number;
  relayMinFeeUsd?: number;
  tokens: Record<string, `0x${string}`>;
  counts: { commitments: number; nullifiers: number; swaps: number; batches: number };
}

export interface CommitmentRow {
  index: number;
  commitment: `0x${string}`;
  ciphertext: `0x${string}`;
  block: number;
  tx: `0x${string}`;
}

export interface SwapRow {
  index: number;
  commitment: `0x${string}`;
  batchId: string;
  assetIn: `0x${string}`;
  assetOut: `0x${string}`;
  amountIn: string;
  ciphertext: `0x${string}`;
  block: number;
  tx: `0x${string}`;
}

export interface BatchRow {
  assetIn: `0x${string}`;
  assetOut: `0x${string}`;
  batchId: string;
  totalIn: string;
  totalOut: string;
  executed: boolean;
  /** Cancelled instead of traded: claims pay the order back in the asset it sold. */
  refunded: boolean;
}

export interface ActivityRow {
  id: number;
  kind: 'shield' | 'unshield' | 'swap' | 'batch';
  asset: string | null;
  amount: string | null;
  block: number;
  tx: `0x${string}`;
  ts: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`node ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? 'node rejected the request');
  return json;
}

const PAGE = 5000;

/** Every row from `from` on, in order, through the node's page limit. Generic: the same request whichever leaves are ours. */
async function all<T>(path: string, from: number): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = (await get<{ rows: T[] }>(`${path}?from=${from}&limit=${PAGE}`)).rows;
    rows.push(...page);
    if (page.length < PAGE) return rows;
    from += page.length;
  }
}

/** Every row of an offset-paged list. */
async function allOffset<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = (await get<{ rows: T[] }>(`${path}?limit=${PAGE}&offset=${offset}`)).rows;
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export const nodeApi = {
  state: () => get<NodeState>('/state'),
  commitments: (from = 0, limit = PAGE) => get<{ rows: CommitmentRow[] }>(`/commitments?from=${from}&limit=${limit}`),
  allCommitments: (from = 0) => all<CommitmentRow>('/commitments', from),
  allSwaps: (from = 0) => all<SwapRow>('/swaps', from),
  /** Every batch the node knows, so an order of any age can find its totals without naming its pair. */
  allBatches: () => allOffset<BatchRow>('/batches'),
  nullifiers: () => get<{ rows: `0x${string}`[] }>('/nullifiers'),
  claims: () => get<{ rows: `0x${string}`[] }>('/claims'),
  swaps: (from = 0, limit = 5000) => get<{ rows: SwapRow[] }>(`/swaps?from=${from}&limit=${limit}`),
  batches: (assetIn?: string, assetOut?: string) =>
    get<{ rows: BatchRow[] }>(assetIn && assetOut ? `/batches?assetIn=${assetIn}&assetOut=${assetOut}` : '/batches?limit=40'),
  activity: (limit = 40) => get<{ rows: ActivityRow[] }>(`/activity?limit=${limit}`),
  /** The relay's fee schedule for an asset: a share of amounts leaving the pool, and a flat minimum on every transaction. */
  relayFee: (asset: string) => get<{ bps: number; flat: string }>(`/relay/fee/${asset}`),
  relay: (body: unknown) => post<{ hash: `0x${string}` }>('/relay', body),
  claim: (body: unknown) => post<{ hash: `0x${string}` }>('/claim', body),
};

export async function nodeReachable(): Promise<boolean> {
  try {
    await get('/health');
    return true;
  } catch {
    return false;
  }
}

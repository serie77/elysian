import { upstream } from '@/lib/server/upstream';

/** What a wallet front end needs and nothing else, so the endpoint cannot be used as a free archive node. */
const ALLOWED = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getTransactionCount',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_sendRawTransaction',
  'net_version',
]);

const refuse = (status: number, message: string) => Response.json({ jsonrpc: '2.0', id: null, error: { code: -32601, message } }, { status });

/** JSON-RPC relay: the browser talks to this route, this route talks to the provider with the key attached. */
export async function POST(req: Request, { params }: { params: Promise<{ chain: string }> }) {
  // Browsers on other sites cannot borrow the relay; our own pages send a matching Origin (or none at all).
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return refuse(403, 'Not allowed');
  const url = upstream((await params).chain);
  if (!url) return refuse(404, 'Unknown network');
  const body = await req.json().catch(() => undefined);
  const calls = Array.isArray(body) ? body : [body];
  if (!body || calls.length > 50 || !calls.every((c) => ALLOWED.has(c?.method))) return refuse(403, 'Method not available');
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
  } catch {
    return refuse(502, 'Network unavailable, try again');
  }
}

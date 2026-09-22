import { upstream } from '@/lib/server/upstream';
import { recentTransfers, type TransferFeed } from '@/lib/transfers';

export const dynamic = 'force-dynamic';

const TTL = 8_000;
let cached: { at: number; feed: TransferFeed } | undefined;

/** The newest real transfers on Robinhood Chain mainnet, shared between visitors for a few seconds. */
export async function GET() {
  try {
    if (!cached || Date.now() - cached.at > TTL) cached = { at: Date.now(), feed: await recentTransfers(upstream(4663)!) };
    // Vercel's edge holds this for a few seconds too, so a burst of visitors is one upstream call, not hundreds.
    return Response.json(cached.feed, { headers: { 'cache-control': 'public, s-maxage=8, stale-while-revalidate=30' } });
  } catch {
    return Response.json({ error: 'Transfers unavailable' }, { status: 502 });
  }
}

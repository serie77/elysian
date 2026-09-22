'use client';

import { useEffect, useRef, useState } from 'react';
import { usePublicClient } from 'wagmi';

/**
 * Seconds since epoch according to the chain, not this machine. Batches are cut by block.timestamp,
 * and a browser clock that is half a minute off would aim intents at the wrong batch.
 */
export function useChainClock(): number {
  const client = usePublicClient();
  const offset = useRef(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!client) return;
    let live = true;
    const sync = async () => {
      try {
        const block = await client.getBlock({ blockTag: 'pending' }).catch(() => client.getBlock());
        if (live) offset.current = Number(block.timestamp) - Date.now() / 1000;
      } catch {
        /* keep the last offset */
      }
    };
    void sync();
    const resync = setInterval(sync, 15_000);
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000 + offset.current)), 1000);
    return () => {
      live = false;
      clearInterval(resync);
      clearInterval(tick);
    };
  }, [client]);

  return now;
}

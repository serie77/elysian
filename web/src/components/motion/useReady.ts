'use client';

import { useEffect, useState } from 'react';
import { onReady } from './Preloader';

/** True once the preloader has lifted (or immediately when there is no preloader on the page). */
export function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    if (html.dataset.ready === undefined || html.dataset.ready === '1') {
      setReady(true);
      return;
    }
    return onReady(() => setReady(true));
  }, []);
  return ready;
}

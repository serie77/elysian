'use client';

import { useEffect, useState } from 'react';

export function useMedia(query: string, initial = false): boolean {
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useIsDesktop = () => useMedia('(min-width: 768px)');

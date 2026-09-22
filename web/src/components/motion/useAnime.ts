'use client';

import { createScope, type Scope } from 'animejs';
import { useEffect, useRef } from 'react';

/**
 * Runs anime.js code scoped to a root element. Everything created inside the callback is
 * reverted when the component unmounts, which keeps React's strict-mode double mount clean.
 */
export function useAnime<T extends HTMLElement = HTMLDivElement>(build: (scope: Scope) => void, deps: unknown[] = []) {
  const root = useRef<T>(null);
  useEffect(() => {
    if (!root.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.current.querySelectorAll<HTMLElement>('.will-reveal').forEach((el) => (el.style.opacity = '1'));
      return;
    }
    const scope = createScope({ root }).add((self) => build(self as Scope));
    return () => scope.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return root;
}

export const enterFromBelow = { container: 'bottom-=64', target: 'top' } as const;
export const leaveAbove = { container: 'top', target: 'bottom' } as const;

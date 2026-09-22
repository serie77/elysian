'use client';

import Lenis from 'lenis';
import { useEffect } from 'react';

/** Inertial scrolling for the whole document. anime.js scroll observers read the native scroll position, so they stay in sync. */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9, touchMultiplier: 1.4 });
    // SectionLink scrolls through this instance so programmatic jumps stay smooth.
    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;
    let frame = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      delete (window as unknown as { __lenis?: Lenis }).__lenis;
      lenis.destroy();
    };
  }, []);
  return null;
}

'use client';

import { animate, onScroll, scrambleText } from 'animejs';
import { useEffect, useRef } from 'react';
import { enterFromBelow } from './useAnime';

/** Mono label that resolves out of noise when it scrolls into view. */
export function Scramble({ text, className = '', delay = 0, immediate = false }: { text: string; className?: string; delay?: number; immediate?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const anim = animate(el, {
      innerHTML: scrambleText({ chars: 'uppercase', from: 'left', cursor: false }),
      duration: 900,
      delay,
      ease: 'linear',
      autoplay: immediate ? true : onScroll({ target: el, enter: enterFromBelow }),
    });
    return () => {
      anim.revert();
      el.textContent = text;
    };
  }, [text, delay, immediate]);
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}

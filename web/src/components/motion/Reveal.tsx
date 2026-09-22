'use client';

import { animate, onScroll, stagger } from 'animejs';
import { useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { enterFromBelow } from './useAnime';

interface RevealProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  delay?: number;
  y?: number;
  /** Animate direct children with a stagger instead of the wrapper. */
  cascade?: boolean;
  step?: number;
}

/** Fades an element (or its children) up into view the first time it scrolls into the viewport. */
export function Reveal({ children, className, as: Tag = 'div', delay = 0, y = 28, cascade = false, step = 70 }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.opacity = '1';
      el.querySelectorAll<HTMLElement>(':scope > .will-reveal').forEach((c) => (c.style.opacity = '1'));
      return;
    }
    const targets = cascade ? Array.from(el.children) : el;
    const anim = animate(targets, {
      opacity: [0, 1],
      y: [y, 0],
      duration: 1100,
      delay: cascade ? stagger(step, { start: delay }) : delay,
      ease: 'outQuint',
      autoplay: onScroll({ target: el, enter: enterFromBelow }),
    });
    return () => {
      anim.revert();
    };
  }, [cascade, delay, step, y]);
  return (
    <Tag ref={ref} className={`${cascade ? '' : 'will-reveal'} ${className ?? ''}`.trim()}>
      {children}
    </Tag>
  );
}

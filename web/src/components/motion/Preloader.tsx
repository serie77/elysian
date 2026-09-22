'use client';

import { createTimeline, stagger, svg, utils } from 'animejs';
import { useEffect, useRef } from 'react';
import { Mark } from '../ui/Mark';

const READY_EVENT = 'elysian:ready';

/** Fires once the preloader has released the page. Safe to call after the fact. */
export function onReady(cb: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  if (document.documentElement.dataset.ready === '1') {
    cb();
    return () => undefined;
  }
  window.addEventListener(READY_EVENT, cb, { once: true });
  return () => window.removeEventListener(READY_EVENT, cb);
}

/**
 * The curtain. Traces the mark, counts to one hundred against real readiness (fonts, first paint,
 * a minimum dwell), then opens as three horizontal bars sliding away. Shorter on repeat visits within the same session.
 */
export function Preloader() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const html = document.documentElement;
    html.dataset.ready = '0';
    html.classList.add('is-loading');

    let seen = false;
    try {
      seen = sessionStorage.getItem('elysian.loaded') === '1';
      sessionStorage.setItem('elysian.loaded', '1');
    } catch {
      /* private mode */
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dwell = reduced ? 300 : seen ? 1100 : 2400;

    const release = () => {
      html.dataset.ready = '1';
      html.classList.remove('is-loading');
      window.dispatchEvent(new Event(READY_EVENT));
    };

    const intro = createTimeline({ defaults: { ease: 'inOutCubic' } });
    intro
      .add(svg.createDrawable('.pl-mark path, .pl-mark circle'), { draw: ['0 0', '0 1'], duration: 1500, delay: stagger(140), ease: 'inOutSine' }, 0)
      .add('.pl-count', { textContent: [0, 100], modifier: utils.round(0), duration: dwell - 200 }, 0)
      .add('.pl-bar', { scaleX: [0, 1], duration: dwell - 200 }, 0)
      .add('.pl-word', { opacity: [0, 1], y: [8, 0], duration: 700, delay: stagger(60) }, 300);

    let cancelled = false;
    Promise.all([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, dwell))]).then(() => {
      if (cancelled) return;
      const out = createTimeline({
        onComplete: () => {
          el.style.display = 'none';
        },
      });
      out
        .add('.pl-inner', { opacity: [1, 0], y: [0, -14], duration: 450, ease: 'inQuart' }, 0)
        .add('.pl-band', { x: ['0%', '101%'], duration: 1150, ease: 'inOutExpo', delay: stagger(110, { from: 'center' }) }, 250)
        .call(release, 700);
    });

    return () => {
      cancelled = true;
      intro.revert();
      html.classList.remove('is-loading');
    };
  }, []);

  return (
    <div ref={root} className="pointer-events-none fixed inset-0 z-[100]" aria-hidden>
      {/* The curtain is the logo: three bars, and the middle one leaves first. */}
      <div className="absolute inset-0">
        {[0, 1, 2].map((i) => (
          <div key={i} className="pl-band absolute inset-x-0 bg-[var(--bg)]" style={{ top: `${i * 33.333}%`, height: 'calc(33.334% + 1px)' }} />
        ))}
      </div>
      <div className="pl-inner absolute inset-0 flex flex-col items-center justify-center">
        <Mark size={104} trace className="pl-mark text-[var(--ink)]" />
        <div className="mt-9 flex items-baseline gap-3">
          <span className="pl-word will-reveal wordmark text-[var(--ink)]">Elysian</span>
        </div>
        <div className="mt-8 w-[220px]">
          <div className="h-px w-full bg-[var(--line)]">
            <div className="pl-bar h-px w-full origin-left bg-[var(--bone)]" style={{ transform: 'scaleX(0)' }} />
          </div>
          <div className="mt-3 flex justify-between">
            <span className="label">loading</span>
            <span className="label tabular text-[var(--bone-2)]">
              <span className="pl-count">0</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

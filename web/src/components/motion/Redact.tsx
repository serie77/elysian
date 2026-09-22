'use client';

import { createTimeline } from 'animejs';
import { useEffect, useRef, type ElementType } from 'react';

export interface Segment {
  t: string;
  soft?: boolean;
  green?: boolean;
}

interface RedactProps {
  segments: Segment[];
  as?: ElementType;
  className?: string;
  /** Start once this flips true (for the hero, which waits on the preloader). Defaults to on-scroll. */
  play?: boolean;
  delay?: number;
  step?: number;
}

/**
 * Elysian's signature reveal. Every word starts under a redaction bar; the bar slides on, the
 * word appears beneath it, and the bar slides off the other side.
 */
export function Redact({ segments, as: Tag = 'span', className = '', play, delay = 0, step = 70 }: RedactProps) {
  const ref = useRef<HTMLElement>(null);
  // Callers pass a fresh array every render; key the effect on the words so a re-render never replays it.
  const signature = segments.map((s) => s.t).join('|');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = Array.from(el.querySelectorAll<HTMLElement>('.rd'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      words.forEach((w) => ((w.firstElementChild as HTMLElement).style.opacity = '1'));
      return;
    }
    if (play === false) return;

    // Played once by an IntersectionObserver rather than linked to a scroll observer: inside a pinned
    // section the observer would see the heading's original position leave the viewport and reset it.
    const tl = createTimeline({ autoplay: play === true });
    words.forEach((w, i) => {
      const text = w.children[0] as HTMLElement;
      const bar = w.children[1] as HTMLElement;
      const at = delay + i * step;
      tl.add(bar, { x: ['-101%', '0%'], duration: 300, ease: 'inOutQuart' }, at)
        .add(text, { opacity: [0, 1], duration: 1 }, at + 300)
        .add(bar, { x: ['0%', '101%'], duration: 420, ease: 'inOutQuart' }, at + 320);
    });
    let io: IntersectionObserver | undefined;
    if (play === undefined) {
      io = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          tl.play();
          io?.disconnect();
        },
        { rootMargin: '0px 0px -8% 0px' },
      );
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      tl.revert();
    };
  }, [play, delay, step, signature]);

  let key = 0;
  return (
    <Tag ref={ref} className={className}>
      {segments.map((seg) =>
        seg.t.split(' ').map((word) => (
          <span key={key++}>
            <span className="rd">
              <span className={`rd-t ${seg.soft ? 'soft' : seg.green ? 'green' : ''}`}>{word}</span>
              <span className={`rd-b ${seg.soft ? 'rd-b-soft' : seg.green ? 'rd-b-green' : ''}`} aria-hidden />
            </span>{' '}
          </span>
        )),
      )}
    </Tag>
  );
}

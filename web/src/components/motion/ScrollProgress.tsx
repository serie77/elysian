'use client';

import { animate, onScroll } from 'animejs';
import { useEffect, useRef } from 'react';

/** A hairline at the right edge that fills with the document's scroll progress. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = animate(el, {
      scaleY: [0, 1],
      ease: 'linear',
      autoplay: onScroll({
        target: document.body,
        enter: { container: 'top', target: 'top' },
        leave: { container: 'bottom', target: 'bottom' },
        sync: true,
      }),
    });
    return () => {
      anim.revert();
    };
  }, []);
  return (
    <div className="pointer-events-none fixed right-0 top-0 z-40 hidden h-dvh w-px bg-[var(--line)] md:block">
      <div ref={ref} className="h-full w-full origin-top bg-[var(--bone-2)]" style={{ transform: 'scaleY(0)' }} />
    </div>
  );
}

'use client';

import { animate } from 'animejs';
import { useEffect, useRef, type ReactNode } from 'react';

/** Wraps a control so it leans toward the pointer inside a small radius and springs back after. */
export function Magnetic({ children, radius = 90, strength = 0.32, className = '' }: { children: ReactNode; radius?: number; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    let inside = false;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < radius + Math.max(r.width, r.height) / 2) {
        inside = true;
        el.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
      } else if (inside) {
        inside = false;
        animate(el, { x: 0, y: 0, duration: 700, ease: 'outElastic(1, .5)' });
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [radius, strength]);

  return (
    <div ref={ref} className={`inline-block will-change-transform ${className}`}>
      {children}
    </div>
  );
}

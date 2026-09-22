'use client';

import { useEffect, useRef } from 'react';

/**
 * A dot that sits on the pointer and a ring that follows it with inertia. Interactive targets
 * open the ring; elements with data-cursor="…" print a word inside it. Pointer devices only.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const d = dot.current;
    const r = ring.current;
    const l = label.current;
    if (!d || !r || !l) return;
    document.documentElement.classList.add('has-cursor');

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let rx = target.x;
    let ry = target.y;
    let scale = 1;
    let wanted = 1;
    let visible = false;
    let frame = 0;

    const move = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      if (!visible) {
        visible = true;
        d.style.opacity = '1';
        r.style.opacity = '1';
      }
      d.style.transform = `translate(${target.x}px, ${target.y}px) translate(-50%, -50%)`;
    };
    const over = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const tagged = t?.closest?.('[data-cursor]') as HTMLElement | null;
      const interactive = t?.closest?.('a, button, input, select, textarea, label, [role="button"]');
      l.textContent = tagged?.dataset.cursor ?? '';
      wanted = tagged ? 3.2 : interactive ? 1.9 : 1;
      r.classList.toggle('is-word', Boolean(tagged));
    };
    const leave = () => {
      visible = false;
      d.style.opacity = '0';
      r.style.opacity = '0';
    };
    const loop = () => {
      rx += (target.x - rx) * 0.14;
      ry += (target.y - ry) * 0.14;
      scale += (wanted - scale) * 0.18;
      r.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('mouseover', over, { passive: true });
    document.documentElement.addEventListener('mouseleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      document.removeEventListener('mouseover', over);
      document.documentElement.removeEventListener('mouseleave', leave);
      document.documentElement.classList.remove('has-cursor');
    };
  }, []);

  return (
    <>
      <div ref={dot} className="cursor-dot" aria-hidden />
      <div ref={ring} className="cursor-ring" aria-hidden>
        <span ref={label} className="cursor-label" />
      </div>
    </>
  );
}

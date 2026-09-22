'use client';

import { useEffect, useRef } from 'react';

/**
 * The west wind. Homer's Elysium has no storms, only Zephyrus blowing in off the ocean, so the
 * page's air moves the same way: a few thousand one-pixel marks carried west to east along a
 * time-varying vector field, thinning near the pointer and drifting with scroll. Most are white,
 * a few blue sparks. Drawn with translucent clears so every point
 * leaves a short trail. Cheap enough to run on a phone.
 */
export function Field({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    // The marks are a pixel wide and always moving, so the canvas never needs more than a 1080p screen's worth of pixels;
    // a 4K monitor would otherwise push five times that through the compositor every frame.
    let dpr = 1;
    let w = 0;
    let h = 0;
    let pts: Float32Array = new Float32Array(0);
    let count = 0;
    const mouse = { x: -9999, y: -9999 };
    let scrollDrift = 0;
    let lastScroll = window.scrollY;
    let t = 0;
    let frame = 0;
    let running = true;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(1, Math.sqrt(2_100_000 / (w * h)));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      count = Math.min(640, Math.floor((w * h) / 3300) * density);
      pts = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pts[i * 3] = Math.random() * w;
        pts[i * 3 + 1] = Math.random() * h;
        pts[i * 3 + 2] = Math.random() * 400;
      }
      ctx.fillStyle = 'rgba(10,10,11,1)';
      ctx.fillRect(0, 0, w, h);
    };

    const angle = (x: number, y: number) => {
      const s = 0.0016;
      return (
        Math.sin(x * s + t * 0.21) * Math.cos(y * s * 1.3 - t * 0.17) * Math.PI * 1.6 +
        Math.sin((x - y) * s * 0.55 + t * 0.09) * Math.PI * 0.7
      );
    };

    const step = () => {
      if (!running) return;
      t += 0.006;
      const sy = window.scrollY;
      scrollDrift += (sy - lastScroll) * 0.02;
      scrollDrift *= 0.92;
      lastScroll = sy;

      ctx.fillStyle = 'rgba(10,10,11,0.12)';
      ctx.fillRect(0, 0, w, h);
      const asphodel = Math.floor(count * 0.7);
      const gold = Math.floor(count * 0.93);
      ctx.fillStyle = 'rgba(244,244,245,0.1)';

      for (let i = 0; i < count; i++) {
        if (i === asphodel) ctx.fillStyle = 'rgba(244,244,245,0.18)';
        else if (i === gold) ctx.fillStyle = 'rgba(125,180,255,0.42)';
        const ix = i * 3;
        let x = pts[ix];
        let y = pts[ix + 1];
        let age = pts[ix + 2] + 1;
        const a = angle(x, y);
        let vx = Math.cos(a) * 0.32 + 0.16;
        let vy = Math.sin(a) * 0.32 - scrollDrift * 0.08;
        const dx = x - mouse.x;
        const dy = y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 22000) {
          const f = (1 - d2 / 22000) * 2.2;
          const d = Math.sqrt(d2) || 1;
          vx += (dx / d) * f;
          vy += (dy / d) * f;
        }
        x += vx;
        y += vy;
        if (x < 0 || x > w || y < 0 || y > h || age > 420) {
          x = Math.random() * w;
          y = Math.random() * h;
          age = 0;
        }
        pts[ix] = x;
        pts[ix + 1] = y;
        pts[ix + 2] = age;
        ctx.fillRect(x, y, i < gold ? 1 : 1.5, i < gold ? 1 : 1.5);
      }
      frame = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onVisibility = () => {
      running = !document.hidden;
      if (running) frame = requestAnimationFrame(step);
      else cancelAnimationFrame(frame);
    };

    resize();
    frame = requestAnimationFrame(step);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [density]);

  return <canvas ref={ref} className="field pointer-events-none fixed inset-0 z-0" aria-hidden />;
}

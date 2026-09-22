'use client';

import { useEffect, useRef } from 'react';
import { MARK_CUT, MARK_GLYPH, MARK_SPEAR } from '../ui/Mark';
import { onReady } from './Preloader';

interface P {
  hx: number;
  hy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Palette bucket. Dots are drawn one bucket at a time, a single filled path each. */
  c: number;
}

// Shadow to highlight, in white: the mark is a white glyph lit from the upper left.
const STOPS = [
  [54, 56, 62],
  [128, 130, 136],
  [222, 220, 214],
  [255, 255, 255],
];
const SHADES = Array.from({ length: 10 }, (_, i) => {
  const f = (i / 9) * (STOPS.length - 1);
  const k = Math.min(STOPS.length - 2, Math.floor(f));
  const [a, b] = [STOPS[k], STOPS[k + 1]];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * (f - k))).join(',')})`;
});

/**
 * The mark as a halftone of a couple of thousand dots, sampled from the real logo outline. They
 * drift in as dust, settle into the letter once the page is ready, lean away from the pointer, and
 * come apart as you scroll. Lit from the upper left, with a glint that crosses it every few seconds.
 */
export function Emblem({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    let pts: P[] = [];
    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let R = 1;
    let formed = reduced ? 1 : 0;
    let forming = reduced;
    let t = 0;
    let raf = 0;
    let visible = true;
    const mouse = { x: -1e4, y: -1e4 };

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      if (!w || !h) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w / 2;
      cy = h / 2;
      const size = Math.min(w, h) * 0.94;
      R = size / 2;
      const step = Math.max(4, Math.round(size / 118));

      // Rasterise the logo once, then keep a dot wherever the grid lands on ink.
      const s = size / 24;
      const stencil = document.createElement('canvas');
      stencil.width = stencil.height = Math.ceil(size);
      const sc = stencil.getContext('2d', { willReadFrequently: true })!;
      sc.scale(s, s);
      sc.fill(new Path2D(MARK_GLYPH));
      sc.clearRect(MARK_CUT.x, 0, MARK_CUT.w, 24);
      sc.fill(new Path2D(MARK_SPEAR));
      const ink = sc.getImageData(0, 0, stencil.width, stencil.height).data;

      pts = [];
      for (let y = 0; y < stencil.height; y += step) {
        for (let x = 0; x < stencil.width; x += step) {
          if (ink[(y * stencil.width + x) * 4 + 3] < 128) continue;
          const nx = x / size - 0.5;
          const ny = y / size - 0.5;
          const light = Math.min(1, Math.max(0, 0.52 - 0.75 * nx - 0.95 * ny));
          const spread = reduced ? 0 : 1;
          const hx = cx - R + x;
          const hy = cy - R + y;
          pts.push({
            hx,
            hy,
            x: hx + (Math.random() - 0.5) * w * 1.8 * spread,
            y: hy + (Math.random() - 0.5) * h * 1.8 * spread,
            vx: 0,
            vy: 0,
            r: step * (0.2 + light * 0.26),
            c: Math.min(SHADES.length - 1, Math.floor(light * SHADES.length)),
          });
        }
      }
      pts.sort((a, b) => a.c - b.c);
    };

    const frame = () => {
      if (!visible) return;
      t += 0.016;
      if (forming && formed < 1) formed = Math.min(1, formed + 0.012);
      const scatter = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.85)));
      const k = 0.055 * formed;
      const sweep = ((t * 0.15) % 1) * 6 - 3;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = (0.3 + 0.7 * formed) * (1 - scatter * 0.8);
      let shade = -1;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.c !== shade) {
          if (shade !== -1) ctx.fill();
          shade = p.c;
          ctx.fillStyle = SHADES[shade];
          ctx.beginPath();
        }
        const wob = Math.sin(t * 1.1 + p.hx * 0.018 + p.hy * 0.014) * 1.3;
        let tx = p.hx;
        let ty = p.hy + wob;
        if (scatter > 0) {
          const s = scatter * scatter;
          tx += (p.hx - cx) * s * 2.4 + Math.sin(p.hy * 0.045 + t) * 60 * s;
          ty += (p.hy - cy) * s * 2.4 + Math.cos(p.hx * 0.045 + t) * 60 * s;
        }
        p.vx += (tx - p.x) * k;
        p.vy += (ty - p.y) * k;
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 16000) {
          const f = (1 - d2 / 16000) * 3.2;
          const d = Math.sqrt(d2) || 1;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
        p.vx *= 0.84;
        p.vy *= 0.84;
        p.x += p.vx;
        p.y += p.vy;
        const glint = Math.max(0, 1 - Math.abs((p.hx - cx - (p.hy - cy) * 0.55) / R - sweep) * 2.4) * formed * (1 - scatter);
        const r = p.r * (1 + glint * 0.7);
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, 6.2832);
      }
      if (shade !== -1) ctx.fill();
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    let inView = true;
    const wake = () => {
      const was = visible;
      visible = inView && !document.hidden;
      if (visible && !was) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      wake();
    });
    const onVisibility = wake;

    build();
    io.observe(canvas);
    raf = requestAnimationFrame(frame);
    const off = onReady(() => {
      forming = true;
    });
    window.addEventListener('resize', build);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      off();
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', build);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}

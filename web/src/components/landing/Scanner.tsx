'use client';

import { animate, onScroll } from 'animejs';
import { useEffect, useRef, useState } from 'react';
import { short } from '@/lib/assets';
import snapshot from '@/lib/chain-transfers.json';
import { EXPLORER, type TransferFeed } from '@/lib/transfers';
import { useAnime } from '../motion/useAnime';
import { TokenIcon } from '../ui/TokenIcon';

const ROWS = snapshot.rows.length;
const SECRET = ROWS * 3;

/**
 * The pitch in one gesture. A block explorer table, pinned; as you scroll, a scan line crosses it
 * and everything a stranger could use against you goes under a redaction bar. The proof column
 * is the only thing that lights up. The rows are real: the latest transfers on Robinhood Chain
 * mainnet, fetched on load, with a frozen set of equally real ones underneath until they arrive.
 */
export function Scanner() {
  const counter = useRef<HTMLSpanElement>(null);
  const [rows, setRows] = useState(snapshot.rows);
  const [block, setBlock] = useState(snapshot.block);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/transfers')
      .then((res) => (res.ok ? (res.json() as Promise<TransferFeed>) : Promise.reject()))
      .then((latest) => {
        // The row count is fixed so the scan cells the animation holds stay the same elements.
        if (!mounted || latest.rows.length !== ROWS) return;
        setRows(latest.rows);
        setBlock(latest.block);
        setLive(true);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const root = useAnime((scope) => {
    const section = scope.root as HTMLElement;
    const table = section.querySelector<HTMLElement>('.scan-table')!;
    const cells = Array.from(section.querySelectorAll<HTMLElement>('.scan-cell'));
    const proofs = Array.from(section.querySelectorAll<HTMLElement>('.scan-proof'));
    const before = section.querySelector<HTMLElement>('.scan-before')!;
    const after = section.querySelector<HTMLElement>('.scan-after')!;
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    // Horizontal positions only change on resize or when new rows arrive, so they are measured then,
    // not on every scroll frame.
    let width = 1;
    let cellX: [number, number][] = [];
    let proofX: number[] = [];
    const measure = () => {
      const box = table.getBoundingClientRect();
      width = box.width;
      cellX = cells.map((c) => {
        const r = c.getBoundingClientRect();
        return [r.left - box.left, Math.max(1, r.width)];
      });
      proofX = proofs.map((p) => {
        const r = p.getBoundingClientRect();
        return r.left - box.left + r.width / 2;
      });
    };
    let lastProgress = 0;

    const apply = (progress: number) => {
      lastProgress = progress;
      const scanX = width * progress;
      let exposed = 0;
      cells.forEach((cell, i) => {
        const f = Math.min(1, Math.max(0, (scanX - cellX[i][0]) / cellX[i][1]));
        (cell.lastElementChild as HTMLElement).style.transform = `scaleX(${f})`;
        if (f < 0.5) exposed++;
      });
      proofs.forEach((p, i) => {
        p.style.opacity = scanX > proofX[i] ? '1' : '0.12';
      });
      if (counter.current) {
        counter.current.textContent = String(exposed);
        counter.current.style.color = exposed ? '' : 'var(--green)';
      }
      const k = smooth(0.42, 0.62, progress);
      before.style.opacity = String(1 - k);
      after.style.opacity = String(k);
    };

    animate('.scan-line', {
      left: ['0%', '100%'],
      ease: 'linear',
      autoplay: onScroll({
        target: section,
        enter: { container: 'top', target: 'top' },
        leave: { container: 'bottom', target: 'bottom' },
        sync: true,
        onUpdate: (self) => apply(Math.min(1, Math.max(0, (self.progress - 0.08) / 0.8))),
      }),
    });
    const remeasure = () => {
      measure();
      apply(lastProgress);
    };
    const ro = new ResizeObserver(remeasure);
    ro.observe(table);
    cells.forEach((c) => ro.observe(c));
    remeasure();
    return () => ro.disconnect();
  });

  return (
    <section ref={root} id="why" className="relative" style={{ height: '300vh' }}>
      <div className="sticky top-0 flex h-dvh flex-col justify-center overflow-hidden">
        <div className="container-x">
          <div className="flex items-center justify-between gap-4">
            <span className="tag">The problem</span>
            <a href={`${EXPLORER}/block/${block}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-[12px] font-medium text-[var(--ink-3)] transition-colors hover:text-[var(--bone)]" data-cursor="Open">
              <span className="live-dot" style={{ background: live ? 'var(--green)' : 'var(--ink-4)', animation: live ? undefined : 'none' }} />
              <span className="hidden sm:inline">Real transfers on <span className="green">Robinhood Chain</span>, </span>
              <span className="mono tabular">block {block.toLocaleString('en-US')}</span>
            </a>
          </div>
          <div className="relative mt-6 h-[2.2em] text-[clamp(2rem,5.2vw,4.6rem)] md:h-[1.2em]">
            <h2 className="scan-before h2 absolute inset-0">
              Today, the chain <span className="soft">sees everything.</span>
            </h2>
            <h2 className="scan-after h2 absolute inset-0" style={{ opacity: 0 }}>
              With Elysian, <span className="soft">it sees a proof.</span>
            </h2>
          </div>

          <div className="scan-table relative mt-10 border-y border-[var(--line-strong)] md:mt-14">
            <div className="scan-line pointer-events-none absolute -bottom-3 -top-3 z-10 w-px bg-[var(--bone)]" style={{ left: '0%', boxShadow: '0 0 24px 2px rgba(239,233,220,0.35)' }} />
            <div className="grid grid-cols-[1fr_1fr_1.1fr_64px] gap-x-4 border-b border-[var(--line)] py-3 text-[12px] font-medium text-[var(--ink-3)] md:grid-cols-[140px_1fr_1fr_1.1fr_120px_90px]">
              <span className="hidden md:block">Transaction</span>
              <span>From</span>
              <span>To</span>
              <span>Amount</span>
              <span className="hidden md:block">Token</span>
              <span className="text-right">Proof</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.1fr_64px] items-center gap-x-4 border-b border-[var(--line)] py-3.5 text-[13px] last:border-b-0 md:grid-cols-[140px_1fr_1fr_1.1fr_120px_90px] md:py-4 md:text-[15px]">
                <a href={`${EXPLORER}/tx/${r.hash}`} target="_blank" rel="noreferrer" className="mono hidden text-[var(--ink-2)] underline decoration-[var(--line-strong)] underline-offset-4 transition-colors hover:text-[var(--bone)] md:block" data-cursor="Open">
                  {short(r.hash)}
                </a>
                <span className="mono">
                  <span className="scan-cell">
                    <span className="md:hidden">{r.from.slice(0, 6)}…</span>
                    <span className="hidden md:inline">{short(r.from)}</span>
                    <span className="scan-bar" />
                  </span>
                </span>
                <span className="mono">
                  <span className="scan-cell">
                    <span className="md:hidden">{r.to.slice(0, 6)}…</span>
                    <span className="hidden md:inline">{short(r.to)}</span>
                    <span className="scan-bar" />
                  </span>
                </span>
                <span className="mono tabular">
                  <span className="scan-cell">
                    {r.amount}
                    <span className="scan-bar" />
                  </span>
                </span>
                <span className="hidden items-center gap-2 font-medium md:flex">
                  <TokenIcon symbol={r.token} size={22} />
                  {r.token}
                </span>
                <span className="scan-proof text-right text-[12px] font-medium text-[var(--green)] transition-opacity duration-300" style={{ opacity: 0.12 }}>
                  valid
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-baseline justify-between">
            <p className="text-[14px] font-medium text-[var(--ink-3)]">Senders, recipients and amounts a stranger can read</p>
            <p className="h2 tabular whitespace-nowrap text-[clamp(2rem,4vw,3.4rem)]">
              <span ref={counter} className="transition-colors duration-500">{SECRET}</span>
              <span className="soft"> / {SECRET}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

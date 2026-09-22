'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { MAINNET_BASE, MEMECOINS, STOCK_TOKENS, type Asset } from '@/lib/assets';
import { hasBrandIcon, TokenIcon } from '../ui/TokenIcon';
import { ArrowTile } from '../ui/Glyph';
import { Section } from './Section';

function Tile({ a }: { a: Asset }) {
  return (
    <div className="tile" data-cursor="Shield">
      <TokenIcon symbol={a.symbol} size={34} />
      <span className="tile-text flex items-baseline gap-2.5">
        <span className="text-[17px] font-medium tracking-[-0.02em]">{a.symbol}</span>
        <span className="max-w-[180px] truncate text-[13px] font-medium text-[var(--ink-3)]">{a.name}</span>
      </span>
      <span className="tile-bar" />
    </div>
  );
}

/** A marquee that runs on its own and leans into your scroll: scroll faster and the tape speeds up. */
function Tape({ items, dir }: { items: Asset[]; dir: 1 | -1 }) {
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let x = 0;
    let boost = 0;
    let last = window.scrollY;
    let raf = 0;
    let paused = false;
    let inView = false;
    let half = el.scrollWidth / 2;
    const onResize = () => (half = el.scrollWidth / 2);
    const tick = () => {
      if (!inView) return;
      const y = window.scrollY;
      boost += Math.abs(y - last) * 0.06;
      boost *= 0.9;
      last = y;
      if (!paused) x += (0.45 + boost) * dir;
      if (x <= -half) x += half;
      if (x > 0) x -= half;
      el.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      raf = requestAnimationFrame(tick);
    };
    const enter = () => (paused = true);
    const leave = () => (paused = false);
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    window.addEventListener('resize', onResize);
    if (dir === 1) x = -half;
    const io = new IntersectionObserver(([entry]) => {
      const was = inView;
      inView = entry.isIntersecting;
      if (inView && !was) {
        last = window.scrollY;
        raf = requestAnimationFrame(tick);
      }
    });
    io.observe(el.parentElement!);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
      window.removeEventListener('resize', onResize);
    };
  }, [dir]);

  return (
    <div className="overflow-hidden py-1.5">
      <div ref={track} className="flex w-max will-change-transform">
        {[...items, ...items].map((a, i) => (
          <Tile key={`${a.symbol}-${i}`} a={a} />
        ))}
      </div>
    </div>
  );
}

export function Assets() {
  // Weave the names people recognise through the long tail so every stretch of tape has logos in it:
  // a memecoin, then a couple of stocks, and so on, so neither crowd owns the tape.
  const stocks = STOCK_TOKENS.filter((t) => hasBrandIcon(t.symbol));
  const known: Asset[] = [...MAINNET_BASE];
  MEMECOINS.forEach((m, i) => known.push(m, ...stocks.slice(i * 3, i * 3 + 3)));
  known.push(...stocks.slice(MEMECOINS.length * 3));
  const rest = STOCK_TOKENS.filter((t) => !hasBrandIcon(t.symbol));
  // Three tapes, each dealt its own share of logos: one recognisable name, then two from the long tail.
  const rows = [0, 1, 2].map((r) => {
    const tail = rest.filter((_, i) => i % 3 === r);
    const lead = known.filter((_, i) => i % 3 === r);
    const row: Asset[] = [];
    lead.forEach((a, i) => row.push(a, ...tail.slice(i * 2, i * 2 + 2)));
    return [...row, ...tail.slice(lead.length * 2)];
  });

  return (
    <Section
      id="assets"
      tag="Assets"
      title={[{ t: 'Any token on' }, { t: 'Robinhood Chain.', green: true }, { t: 'Stocks, memecoins, all of it.', soft: true }]}
      lede={`${STOCK_TOKENS.length} tokenized stocks, USDG, WETH, and whatever launched this morning on long.xyz or Pons. Shield any ERC-20. Buy anything that trades on Uniswap v3, straight from your shielded balance.`}
    >
      <div className="mask-fade-x -mx-[var(--gutter)]">
        {rows.map((r, i) => (
          <Tape key={i} items={r} dir={i % 2 ? 1 : -1} />
        ))}
      </div>
      <div className="mt-10">
        <Link href="/app/shield" className="btn h-12 px-5 text-[14px] font-medium" data-cursor="Open">
          Shield a token
          <ArrowTile />
        </Link>
      </div>
    </Section>
  );
}

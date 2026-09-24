'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { animate, createTimeline, onScroll, stagger, utils } from 'animejs';
import { explorerApi } from '@/lib/explorer';
import { useAnime } from '../motion/useAnime';
import { useReady } from '../motion/useReady';
import { Emblem } from '../motion/Emblem';
import { Redact } from '../motion/Redact';
import { ArrowTile } from '../ui/Glyph';
import { ContractAddress } from './ContractAddress';

const stats = [
  { v: 200, prefix: '', suffix: '+', k: 'Tokens listed. Paste any other.' },
  { v: 2, prefix: '~', suffix: 's', k: 'To prove, in your browser' },
  { v: 60, prefix: '', suffix: 's', k: 'Sealed trade batches' },
];

export function Hero() {
  const ready = useReady();
  // The fourth figure is live: how many shielded transactions the pool has seen, from the node's explorer.
  const [txs, setTxs] = useState<number | null>(null);
  useEffect(() => {
    explorerApi
      .summary()
      .then((s) => setTxs(s.transactions))
      .catch(() => setTxs(null));
  }, []);
  // Count the live figure up once it arrives, like the fixed ones.
  useEffect(() => {
    if (txs === null || txs === 0) return;
    animate('.hero-live', { textContent: [0, txs], modifier: utils.round(0), duration: 1400, ease: 'outExpo' });
  }, [txs]);

  const root = useAnime(
    (scope) => {
      if (!ready) return;
      const tl = createTimeline({ defaults: { ease: 'outExpo' } });
      tl.add('.hero-fade', { opacity: [0, 1], y: [14, 0], duration: 1100, delay: stagger(90), ease: 'outQuint' }, 700);
      tl.add('.hero-stat', { opacity: [0, 1], y: [18, 0], duration: 900, delay: stagger(70), ease: 'outQuint' }, 1000);
      utils.$('.hero-stat-n').forEach((el, i) => {
        if (stats[i].v > 1) tl.add(el, { textContent: [0, stats[i].v], modifier: utils.round(0), duration: 1500, ease: 'outExpo' }, 900 + i * 70);
      });
      animate('.hero-copy', {
        opacity: [1, 0],
        y: [0, -60],
        ease: 'linear',
        autoplay: onScroll({ target: scope.root as HTMLElement, enter: { container: 'top', target: 'center' }, leave: { container: 'top', target: 'bottom' }, sync: true }),
      });
    },
    [ready],
  );

  return (
    <section ref={root} className="hero relative flex min-h-dvh flex-col overflow-hidden">
      <Emblem className="pointer-events-none absolute right-[-10vw] top-[7vh] h-[40vh] w-[120vw] opacity-55 md:right-[-13vw] md:top-[3vh] md:h-[88vh] md:w-[58vw] md:opacity-100" />

      <div className="container-x relative flex flex-1 flex-col justify-end pb-10 pt-40 md:pb-14">
        <div className="hero-copy max-w-[860px]">
          <Redact
            as="h1"
            play={ready}
            step={90}
            className="hero-title display block text-[clamp(2.9rem,7.1vw,6.9rem)]"
            segments={[{ t: 'The privacy layer' }, { t: 'for' }, { t: 'Robinhood Chain.', green: true }]}
          />
          <p className="hero-fade will-reveal mt-8 flex items-start gap-3 text-[16px] font-medium tracking-[-0.01em] text-[var(--ink)] md:text-[18px]">
            <span className="mt-[7px] inline-block h-2.5 w-2.5 flex-none rounded-full bg-[var(--bone)] md:mt-2" />
            <span>
              Buy stocks, memecoins or any token on <span className="green">Robinhood Chain</span>, and send them to anyone. Privately.
            </span>
          </p>
          <div className="hero-fade will-reveal mt-9 flex flex-wrap items-center gap-3">
            <Link href="/app" className="btn btn-solid h-12 px-5 text-[14px] font-medium" data-cursor="Open">
              Launch app
              <ArrowTile />
            </Link>
            <Link href="/protocol" className="btn h-12 px-5 text-[14px] font-medium" data-cursor="Read">
              Read the docs
            </Link>
          </div>
          <ContractAddress className="hero-fade will-reveal mt-5" />
        </div>
      </div>

      <div className="relative bg-[rgba(8,7,12,0.78)]">
        <div className="horizon">
          <span className="horizon-glint" />
        </div>
        <dl className="container-x grid grid-cols-2 md:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.k} className={`hero-stat will-reveal py-6 md:py-8 ${i > 0 ? 'md:border-l md:border-[var(--line)] md:pl-8' : ''} ${i % 2 ? 'border-l border-[var(--line)] pl-6' : ''} ${i > 1 ? 'border-t border-[var(--line)] md:border-t-0' : ''}`}>
              <dd className="h2 tabular text-[clamp(1.9rem,3.4vw,3rem)]">
                {s.prefix}
                <span className="hero-stat-n">{s.v}</span>
                {s.suffix}
              </dd>
              <dt className="mt-2 text-[13px] font-medium tracking-[-0.005em] text-[var(--ink-3)]">{s.k}</dt>
            </div>
          ))}
          <div className="hero-stat will-reveal border-l border-t border-[var(--line)] py-6 pl-6 md:border-t-0 md:py-8 md:pl-8">
            <dd className="h2 tabular text-[clamp(1.9rem,3.4vw,3rem)]">{txs === null ? '–' : <span className="hero-live">{txs.toLocaleString('en-US')}</span>}</dd>
            <dt className="mt-2 text-[13px] font-medium tracking-[-0.005em] text-[var(--ink-3)]">Shielded transactions so far</dt>
          </div>
        </dl>
      </div>
    </section>
  );
}

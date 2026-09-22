'use client';

import Link from 'next/link';
import { animate, onScroll, stagger } from 'animejs';
import { useAnime } from '../motion/useAnime';
import { Redact } from '../motion/Redact';
import { Wordmark } from '../ui/Mark';
import { SectionLink } from './SectionLink';
import { ArrowTile } from '../ui/Glyph';
import { RobinhoodChain } from '../ui/RobinhoodChain';

const footer = [
  { h: 'Product', links: [['Launch app', '/app'], ['Shield', '/app/shield'], ['Send', '/app/send'], ['Trade', '/app/trade'], ['$ELYSIAN', '#token']] },
  { h: 'Learn', links: [['How it works', '#how'], ['Compared', '#compared'], ['Explorer', '/explorer'], ['Docs', '/protocol']] },
  { h: 'Network', links: [['Robinhood Chain', 'https://robin.etherscan.io'], ['Testnet', 'https://explorer.testnet.chain.robinhood.com'], ['Chain docs', 'https://docs.robinhood.com/chain']] },
];

export function Closing() {
  const root = useAnime(() => {
    // The wordmark is redacted letter by letter as it crosses the screen. Only the E survives.
    animate('.giant-bar', {
      scaleX: [0, 1],
      duration: 500,
      delay: stagger(260, { from: 'last' }),
      ease: 'inOutQuart',
      autoplay: onScroll({ target: '.giant', enter: { container: 'bottom-=80', target: 'top' }, leave: { container: 'center', target: 'center' }, sync: true }),
    });
  });

  return (
    <section ref={root} className="relative pt-24 md:pt-40">
      <div className="container-x flex flex-col items-start gap-10 md:flex-row md:items-end md:justify-between">
        <Redact as="h2" step={140} className="display block text-[clamp(3.4rem,11vw,10rem)]" segments={[{ t: 'Go' }, { t: 'private.', soft: true }]} />
        <div className="flex flex-col items-start gap-4 md:items-end md:pb-4">
          <Link href="/app" className="btn btn-solid h-12 px-5 text-[14px] font-medium" data-cursor="Open">
            Launch app
            <ArrowTile />
          </Link>
          <p className="text-[14px] font-medium text-[var(--ink-3)] md:text-right">Connect. Sign once. Shield.</p>
        </div>
      </div>

      <div className="giant relative mt-20 md:mt-28" aria-hidden>
        <div className="container-x relative flex justify-between text-[18.6vw] font-semibold uppercase leading-[0.8] md:text-[min(18.6vw,268px)]">
          {'ELYSIAN'.split('').map((ch, i) => (
            <span key={i} className="relative inline-block">
              <span className="outline-text">{ch}</span>
              {i > 0 ? <span className="giant-bar absolute inset-x-[4%] bottom-[10%] top-[10%] origin-right bg-[var(--bone)]" style={{ transform: 'scaleX(0)' }} /> : null}
            </span>
          ))}
        </div>
      </div>
      <div className="horizon">
        <span className="horizon-glint" />
      </div>

      <div className="container-x relative">
        <footer className="grid gap-12 py-14 md:grid-cols-12">
          <div className="md:col-span-5">
            <Wordmark />
            <p className="mt-6 max-w-[38ch] text-[13px] leading-[1.6] text-[var(--ink-2)]">
              <span className="text-[var(--ink)]">Elysian</span>, of Elysium: in Greek myth, the fields at the western edge of the world, lit by their own sun, where the blessed were left in peace.
            </p>
            <p className="mt-4 max-w-[38ch] text-[13px] leading-[1.6] text-[var(--ink-3)]">
              Independent software. Not affiliated with Robinhood Markets, Inc. Stock Tokens carry jurisdictional restrictions that Elysian
              does not remove.
            </p>
          </div>
          {footer.map((col) => (
            <div key={col.h} className="md:col-span-2">
              <div className="mb-4 text-[13px] font-medium text-[var(--ink-3)]">{col.h}</div>
              <ul className="space-y-2.5">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith('#') ? (
                      <SectionLink section={href.slice(1)} className="text-[14px] font-medium tracking-[-0.005em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]">
                        {label}
                      </SectionLink>
                    ) : (
                      <a href={href} className="text-[14px] font-medium tracking-[-0.005em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]" target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                        {label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </footer>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] py-6 text-[12px] font-medium text-[var(--ink-3)]">
          <span>© 2026 Elysian</span>
          <a href="https://docs.robinhood.com/chain" target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]" data-cursor="Open">
            <span>Built on</span>
            <RobinhoodChain />
          </a>
        </div>
      </div>
    </section>
  );
}

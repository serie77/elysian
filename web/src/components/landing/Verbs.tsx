'use client';

import { useEffect, useRef, useState } from 'react';
import { Redact } from '../motion/Redact';
import { Reveal } from '../motion/Reveal';
import { Glyph } from '../ui/Glyph';

const verbs = [
  { n: '01', verb: 'Shield', line: 'Turn any token into a private balance.' },
  { n: '02', verb: 'Send', line: 'Pay anyone. Sender, recipient and amount stay off the chain.' },
  { n: '03', verb: 'Trade', line: 'Swap in sealed batches, at one fair price.' },
  { n: '04', verb: 'Disclose', line: 'Show your history to whoever you choose.' },
];

/** Small looping illustrations built out of the same redaction bar the logo is made of. */
function Demo({ i, on }: { i: number; on: boolean }) {
  if (i === 0) {
    return (
      <div className="relative flex h-full items-center">
        <span className="mono text-[15px] text-[var(--ink-2)]">1,250.00 NVDA</span>
        <span className="demo-bar absolute left-0 h-[15px] origin-left" style={{ width: 128, transform: `scaleX(${on ? 1 : 0})` }} />
      </div>
    );
  }
  if (i === 1) {
    return (
      <div className="relative h-full">
        <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-[var(--ink-3)]" />
        <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-[var(--ink-3)]" />
        <span className="absolute left-3 right-3 top-1/2 h-px bg-[var(--line-strong)]" />
        <span className="demo-bar absolute top-1/2 h-[11px] w-10 -translate-y-1/2" style={{ left: on ? 'calc(100% - 56px)' : '16px' }} />
      </div>
    );
  }
  if (i === 2) {
    const heights = [44, 18, 56, 28, 38, 12];
    return (
      <div className="flex h-full items-end gap-2.5">
        {heights.map((h, k) => (
          <span key={k} className="demo-bar w-3.5" style={{ height: on ? 30 : h }} />
        ))}
      </div>
    );
  }
  return (
    <div className="relative flex h-full items-center gap-3">
      <Glyph name="eye" size={18} className={`transition-colors duration-700 ${on ? 'text-[var(--bone)]' : 'text-[var(--ink-4)]'}`} />
      <span className="relative">
        <span className="mono text-[15px] text-[var(--ink-2)]">310.50 TSLA</span>
        <span className="demo-bar absolute inset-y-[3px] left-0 right-0 origin-right" style={{ transform: `scaleX(${on ? 0 : 1})` }} />
      </span>
    </div>
  );
}

export function Verbs() {
  const [active, setActive] = useState(-1);
  const [hover, setHover] = useState(-1);
  const list = useRef<HTMLDivElement>(null);

  // Whichever row sits nearest the middle of the screen plays its demo; hover overrides it.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const rowsEl = Array.from(el.querySelectorAll<HTMLElement>('.verb-row'));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          const idx = rowsEl.indexOf(e.target as HTMLElement);
          if (e.isIntersecting) setActive(idx);
        });
      },
      { rootMargin: '-46% 0px -46% 0px' },
    );
    rowsEl.forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, []);

  const current = hover >= 0 ? hover : active;

  return (
    <section id="what" className="relative py-24 md:py-36">
      <div className="container-x">
        <Reveal>
          <span className="tag">What you can do</span>
        </Reveal>
        <Redact as="h2" className="h2 mt-6 block max-w-[14ch] text-[clamp(2.4rem,6vw,5.4rem)]" segments={[{ t: 'Four verbs.' }, { t: 'All private.', soft: true }]} />

        <div ref={list} className="mt-14 border-t border-[var(--line-strong)] md:mt-20">
          {verbs.map((v, i) => (
            <div
              key={v.n}
              data-cursor={v.verb}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              className={`verb-row group relative grid items-center gap-x-8 gap-y-3 border-b border-[var(--line)] py-8 md:grid-cols-[72px_1.1fr_1fr_220px] md:py-11 ${current === i ? 'is-active' : ''}`}
            >
              <span className="mono text-[12px] text-[var(--ink-3)]">{v.n}</span>
              <h3
                className="h2 text-[clamp(2.6rem,7vw,6.4rem)] transition-[color,transform] duration-700"
                style={{ color: current === i ? 'var(--ink)' : 'var(--ink-4)', transform: current === i ? 'translateX(14px)' : 'none', transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1)' }}
              >
                {v.verb}
              </h3>
              <p className={`max-w-[30ch] text-[16px] font-medium leading-[1.45] tracking-[-0.01em] transition-colors duration-700 md:text-[18px] ${current === i ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]'}`}>{v.line}</p>
              <div className="verb-demo hidden h-16 md:block">
                <Demo i={i} on={current === i} />
              </div>
              <span className="verb-line absolute bottom-[-1px] left-0 h-px w-full bg-[var(--bone)]" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

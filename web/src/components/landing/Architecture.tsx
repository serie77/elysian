'use client';

import { animate, onScroll } from 'animejs';
import { useState } from 'react';
import { useAnime } from '../motion/useAnime';
import { useIsDesktop } from '../motion/useMedia';
import { Redact } from '../motion/Redact';
import { Reveal } from '../motion/Reveal';

const steps = [
  { n: '01', name: 'You prove', body: 'Your browser builds a zero-knowledge proof in a couple of seconds. Your keys never leave it.' },
  { n: '02', name: 'We relay', body: 'A relayer submits the proof, so your wallet never appears on-chain.' },
  { n: '03', name: 'The pool verifies', body: 'One contract checks the proof and holds the tokens. It learns nothing else.' },
  { n: '04', name: 'The chain settles', body: 'Robinhood Chain is an Ethereum L2. Your tokens never leave it. No bridge.' },
];

function Head() {
  return (
    <>
      <Reveal>
        <span className="tag">How it works</span>
      </Reveal>
      <Redact as="h2" className="h2 mt-6 block text-[clamp(2.4rem,6vw,5.4rem)]" segments={[{ t: 'Four steps.' }, { t: 'One proof.', soft: true }]} />
    </>
  );
}

/**
 * Every step is on screen the whole time. Scrolling pushes a proof (one redaction bar) down the
 * line; each station lights as the proof reaches it. Nothing slides off-screen at any width.
 */
function Pinned() {
  const [active, setActive] = useState(0);
  const root = useAnime((scope) => {
    const section = scope.root as HTMLElement;
    animate('.pipe-fill', {
      scaleX: [0, 1],
      ease: 'linear',
      autoplay: onScroll({
        target: section,
        enter: { container: 'top', target: 'top' },
        leave: { container: 'bottom', target: 'bottom' },
        sync: true,
        onUpdate: (self) => setActive(Math.min(3, Math.floor(self.progress * 4.001))),
      }),
    });
    animate('.pipe-packet', {
      left: ['0%', '100%'],
      ease: 'linear',
      autoplay: onScroll({ target: section, enter: { container: 'top', target: 'top' }, leave: { container: 'bottom', target: 'bottom' }, sync: true }),
    });
  });

  return (
    <section ref={root} id="how" className="relative" style={{ height: '280vh' }}>
      <div className="sticky top-0 flex h-dvh flex-col justify-center overflow-hidden">
        <div className="container-x">
          <Head />
          <div className="relative mt-16">
            <div className="absolute left-0 right-0 top-[5px] h-px bg-[var(--line-strong)]">
              <div className="pipe-fill h-px w-full origin-left bg-[var(--bone)]" style={{ transform: 'scaleX(0)' }} />
            </div>
            <div className="pipe-packet absolute top-0 z-10 -ml-5 h-[11px] w-10 rounded-[1px] bg-[var(--bone)]" style={{ left: '0%', boxShadow: '0 0 22px rgba(239,233,220,0.45)' }} />
            <div className="grid grid-cols-4 gap-8">
              {steps.map((s, i) => {
                const on = i <= active;
                return (
                  <div key={s.n} className="relative pt-12">
                    <span
                      className="absolute left-0 top-0 h-[11px] w-[11px] rounded-full border transition-colors duration-500"
                      style={{ background: on ? 'var(--bone)' : 'var(--bg)', borderColor: on ? 'var(--bone)' : 'var(--ink-4)' }}
                    />
                    <div className="h2 tabular text-[clamp(3rem,6vw,5.6rem)] transition-colors duration-700" style={{ color: i === active ? 'var(--ink)' : 'var(--ink-4)' }}>
                      {s.n}
                    </div>
                    <h3 className="h2 mt-6 text-[clamp(1.4rem,2.1vw,2rem)] transition-colors duration-700" style={{ color: on ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {s.name}
                    </h3>
                    <p className="mt-3 max-w-[28ch] text-[15px] font-medium leading-[1.5] tracking-[-0.005em] transition-colors duration-700" style={{ color: i === active ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                      {s.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stacked() {
  return (
    <section id="how" className="relative py-24">
      <div className="container-x">
        <Head />
        <Reveal cascade step={90} className="relative mt-12 border-l border-[var(--line-strong)] pl-7">
          {steps.map((s) => (
            <div key={s.n} className="will-reveal relative pb-12 last:pb-0">
              <span className="absolute -left-[34px] top-2 h-[11px] w-[11px] rounded-full bg-[var(--bone)]" />
              <div className="h2 tabular text-[2.6rem] text-[var(--ink-4)]">{s.n}</div>
              <h3 className="h2 mt-3 text-[1.6rem]">{s.name}</h3>
              <p className="mt-2 max-w-[34ch] text-[15px] font-medium leading-[1.5] text-[var(--ink-2)]">{s.body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function Architecture() {
  const desktop = useIsDesktop();
  return desktop ? <Pinned /> : <Stacked />;
}

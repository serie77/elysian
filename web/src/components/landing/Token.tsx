'use client';

import { useState } from 'react';
import { ContractAddress } from './ContractAddress';
import { Section } from './Section';
import { Reveal } from '../motion/Reveal';

const points = [
  {
    h: 'Fixed supply. No allocation.',
    p: 'Pons launches a fixed 1,000,000,000 supply. No team allocation, no presale. Everyone buys on the same terms from the first block.',
  },
  {
    h: 'Creator fees become buybacks.',
    p: 'Every trade pays the 1% Pons fee and Pons sends 70% of it to the token’s creator. Elysian’s share goes to consistent buybacks of $ELYSIAN.',
  },
  {
    h: 'No added tax. Ever.',
    p: 'The fee on $ELYSIAN is the base 1% Pons fee and nothing else. There is no creator tax on top, and there never will be. Buying and selling $ELYSIAN costs what buying and selling anything on Pons costs.',
  },
];

const launchpads = [
  ['Pons', '1%, nothing on top', '70% to the project', '30%, and 80% of that burns PONS'],
  ['Virtuals', '1% tax, up to 99% on buys at launch', '70% to the project', '30%, taken in its own token'],
  ['Flap', 'Creator-set buy and sell taxes', 'Whatever the creator sets', 'A commission on every tax'],
  ['Long.xyz', 'Not published', 'Not published', 'Not published'],
];

/** Where the token launches and why. The comparison with the other launchpads lives in a tooltip. */
export function Token() {
  const [open, setOpen] = useState(false);
  return (
    <Section
      id="token"
      tag="$ELYSIAN"
      title={[{ t: 'The token.' }, { t: 'Launching on Pons.', soft: true }]}
      lede="$ELYSIAN launches on Pons, the launchpad that carries most of the trading on Robinhood Chain. Pons pays the majority of every trade’s fee to the token’s creator, and Elysian puts that fee into consistent buybacks of $ELYSIAN."
    >
      <div className="grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-16">
        <div>
          <div className="grid gap-px overflow-hidden rounded-[3px] border border-[var(--line)] bg-[var(--line)] md:grid-cols-3">
            {points.map((x, i) => (
              <Reveal key={x.h} delay={i * 90} className="bg-[var(--bg)] p-6 md:p-7">
                <h3 className="text-[17px] font-medium tracking-[-0.02em]">{x.h}</h3>
                <p className="mt-3 text-[14px] leading-[1.6] text-[var(--ink-2)]">{x.p}</p>
              </Reveal>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
            <a href="https://www.ponsfamily.com" target="_blank" rel="noreferrer" className="flex items-center gap-3 text-[14px] font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]" data-cursor="Open">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/tokens/pons-logo.png" alt="" width={28} height={28} className="h-7 w-7" />
              Pons launchpad
            </a>
            <div className={`tip ${open ? 'is-open' : ''}`}>
              <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 text-[14px] font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--ink-4)] text-[10px]">?</span>
                Why Pons?
              </button>
              <div className="tip-panel" role="tooltip">
                <p>
                  Most launchpads make their money by taxing the trade. Virtuals puts a 1% tax on every trade, routes it through its own token, and opens each launch with a buy tax that starts at 99% and decays over the first minutes, so early buyers pay the platform and the founders. Flap lets creators bolt their own buy and sell taxes onto a token, its own docs show 3% on buys and 10% on sells, and then takes a commission on the tax itself, which is why Flap launches are known for trading heavy. Long does not publish what it charges at all.
                </p>
                <p className="mt-3">
                  Pons charges 1% on a trade and nothing else, and $ELYSIAN adds no tax on top of it. 70% of that 1% goes to the project, and of the 30% Pons keeps, 80% buys and burns PONS. The trade is the fairest on offer: a fixed supply with no team allocation, and the same terms for everyone from the first block. And Pons carries around two thirds of all launchpad fees on Robinhood Chain, which makes it the deepest set of buyers on the chain.
                </p>
                <p className="mt-3">Fairest trade, least taken, most volume. That is where a token should launch.</p>
                <table className="mt-4 w-full text-[12.5px]">
                  <thead className="text-[var(--ink-3)]">
                    <tr>
                      <th className="pb-2 pr-3 text-left font-medium">Launchpad</th>
                      <th className="pb-2 pr-3 text-left font-medium">Trade fee</th>
                      <th className="pb-2 pr-3 text-left font-medium">To the project</th>
                      <th className="pb-2 pr-3 text-left font-medium">Platform keeps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {launchpads.map((r) => (
                      <tr key={r[0]} className="border-t border-[var(--line)]">
                        {r.map((c, i) => (
                          <td key={i} className={`py-2 pr-3 align-top ${i === 0 ? 'font-medium text-[var(--ink)]' : ''}`}>
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-3 text-[13px] font-medium text-[var(--ink-3)]">Contract address</p>
          <ContractAddress />
          <p className="mt-3 text-[13px] leading-[1.6] text-[var(--ink-3)]">Blank until launch. The address will appear here and on the pinned post first. Trust no other.</p>
        </div>
      </div>
    </Section>
  );
}

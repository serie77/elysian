import { Reveal } from '../motion/Reveal';
import { Section } from './Section';

const cols = ['Elysian', 'Railgun', 'Zcash', 'Aztec', 'Penumbra', 'NEAR Intents'];

const rows: { k: string; v: string[] }[] = [
  { k: 'Runs on', v: ['Robinhood Chain', 'Ethereum + 3 chains', 'Own chain', 'Own L2', 'Own chain', 'NEAR'] },
  { k: 'Assets', v: ['Any ERC-20: stocks, memecoins', 'Any ERC-20', 'ZEC only', 'Bridged tokens', 'IBC assets', 'Via solvers'] },
  { k: 'Private swaps', v: ['Sealed batches, one price', 'Public DEX, hidden caller', 'No', 'Via contracts', 'Sealed batches', 'Solvers, no proofs'] },
  { k: 'Proof made', v: ['In your browser', 'In your browser', 'In your wallet', 'On your device', 'On your device', 'None'] },
  { k: 'Viewing keys', v: ['Yes', 'Yes', 'Yes', 'Per app', 'Yes', 'No'] },
  { k: 'Bridge needed', v: ['No', 'No', 'Yes', 'Yes', 'Yes', 'Yes'] },
];

export function Compared() {
  return (
    <Section
      id="compared"
      tag="Compared"
      title={[{ t: 'Proven ideas.' }, { t: 'A new home.', soft: true }]}
      lede="Elysian invents no new cryptography. It brings the best of shielded design to where the stocks and the memecoins are."
    >
      <div className="scrollbar-thin -mx-[var(--gutter)] overflow-x-auto px-[var(--gutter)]">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[140px_repeat(6,1fr)] border-b border-[var(--line-strong)]">
            <div className="p-4" />
            {cols.map((c, i) => (
              <div key={c} className={`p-4 text-[15px] font-medium tracking-[-0.01em] ${i === 0 ? 'text-[var(--bone)]' : 'text-[var(--ink-2)]'}`}>
                {c}
              </div>
            ))}
          </div>
          <Reveal cascade step={60}>
            {rows.map((r) => (
              <div key={r.k} className="matrix-row will-reveal grid grid-cols-[140px_repeat(6,1fr)] border-b border-[var(--line)]">
                <div className="p-4 text-[13px] font-medium text-[var(--ink-3)]">{r.k}</div>
                {r.v.map((v, i) => (
                  <div key={i} className={`p-4 text-[14px] font-medium leading-[1.4] tracking-[-0.005em] transition-colors ${i === 0 ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]'}`}>
                    {v}
                  </div>
                ))}
              </div>
            ))}
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

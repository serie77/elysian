'use client';

import Link from 'next/link';
import { Gate } from '@/components/app/Gate';
import { PageHead, Row } from '@/components/app/Pieces';
import { findAsset, formatAmount, short } from '@/lib/assets';
import { useAssets } from '@/lib/wallet/useAssets';
import { useShielded } from '@/lib/wallet/store';
import { TokenIcon } from '@/components/ui/TokenIcon';

export default function Overview() {
  return (
    <Gate>
      <Balances />
    </Gate>
  );
}

function Balances() {
  const w = useShielded();
  const { assets } = useAssets();
  const claimable = w.swaps.filter((s) => !w.sync.claims.has(s.nullifier)).length;
  const s = w.sync.state;

  return (
    <>
      <PageHead n="00" title="Overview" sub="Your shielded balances, rebuilt from the public ciphertext log with your viewing key. Nothing here is stored on a server." />

      <div className="grid gap-px bg-[var(--line)] md:grid-cols-12">
        <section className="bg-[var(--bg)] md:col-span-8">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
            <span className="label">Shielded balances</span>
            <button type="button" className="label text-[10px] hover:text-[var(--ink)]" onClick={() => void w.refresh()} disabled={w.syncing}>
              {w.syncing ? 'syncing' : 'refresh'}
            </button>
          </div>
          {w.balances.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="h2 text-[26px]">Nothing shielded yet.</p>
              <p className="mt-3 text-[13px] text-[var(--ink-3)]">Shield any token to create your first note.</p>
              <Link href="/app/shield" className="btn btn-solid mt-8">
                Shield an asset
              </Link>
            </div>
          ) : (
            <ul>
              {w.balances.map((b) => {
                const a = findAsset(assets, b.asset);
                const addr = `0x${b.asset.toString(16).padStart(40, '0')}`;
                return (
                  <li key={addr} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-[var(--line)] px-6 py-5 last:border-b-0 md:grid-cols-[150px_1fr_auto_auto]">
                    <div className="flex items-center gap-3 text-[20px] tracking-[-0.02em]">
                      <TokenIcon symbol={a?.symbol ?? '?'} size={30} />
                      {a?.symbol ?? short(addr)}
                    </div>
                    <div className="hidden text-[13px] text-[var(--ink-3)] md:block">{a?.name ?? addr}</div>
                    <div className="tabular text-right text-[18px]">{formatAmount(b.amount, a?.decimals ?? 18)}</div>
                    <div className="col-span-2 flex gap-2 md:col-span-1">
                      <Link href={`/app/send?asset=${addr}`} className="btn h-8 px-3 text-[11px]">
                        Send
                      </Link>
                      <Link href={`/app/trade?in=${addr}`} className="btn h-8 px-3 text-[11px]">
                        Trade
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="bg-[var(--bg)] md:col-span-4">
          <div className="border-b border-[var(--line)] px-6 py-4">
            <span className="label">Pool</span>
          </div>
          <div className="px-6 py-3">
            <Row k="Notes in tree" v={s?.poolLeaves ?? '–'} />
            <Row k="Nullifiers" v={s?.counts.nullifiers ?? '–'} />
            <Row k="Swap intents" v={s?.counts.swaps ?? '–'} />
            <Row k="Batches cleared" v={s?.counts.batches ?? '–'} />
            <Row k="Current batch" v={s?.currentBatch ?? '–'} />
            <Row k="Root" v={<span className="mono text-[11px]">{s ? short(s.poolRoot, 6) : '–'}</span>} />
          </div>
          <div className="border-t border-[var(--line)] px-6 py-5">
            <div className="label mb-2">Your notes</div>
            <Row k="Unspent" v={w.notes.filter((n) => !w.sync.nullifiers.has(n.nullifier) && n.amount > 0n).length} />
            <Row k="Spent" v={w.notes.filter((n) => w.sync.nullifiers.has(n.nullifier)).length} />
            <Row
              k="Swaps to claim"
              v={
                claimable ? (
                  <Link href="/app/trade" className="text-[var(--bone)]">
                    {claimable}
                  </Link>
                ) : (
                  0
                )
              }
            />
          </div>
        </aside>
      </div>
    </>
  );
}

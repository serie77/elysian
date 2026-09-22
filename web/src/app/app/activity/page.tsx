'use client';

import { useEffect, useState } from 'react';
import { Gate } from '@/components/app/Gate';
import { PageHead, TxLink } from '@/components/app/Pieces';
import { findAsset, formatAmount, short } from '@/lib/assets';
import { useAssets } from '@/lib/wallet/useAssets';
import { nodeApi, type ActivityRow } from '@/lib/node';
import { useShielded } from '@/lib/wallet/store';

export default function ActivityPage() {
  return (
    <Gate>
      <Activity />
    </Gate>
  );
}

function Activity() {
  const w = useShielded();
  const { assets } = useAssets();
  const [rows, setRows] = useState<ActivityRow[]>([]);

  useEffect(() => {
    let live = true;
    const load = () => nodeApi.activity(60).then((r) => live && setRows(r.rows)).catch(() => undefined);
    load();
    const t = setInterval(load, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const mine = [...w.notes].sort((a, b) => b.leafIndex - a.leafIndex);

  return (
    <>
      <PageHead n="05" title="Activity" sub="What the chain shows everyone, next to what only your keys can decode." />
      <div className="grid gap-px bg-[var(--line)] md:grid-cols-12">
        <section className="bg-[var(--bg)] md:col-span-7">
          <div className="border-b border-[var(--line)] px-6 py-4">
            <span className="label">Pool · public</span>
          </div>
          {rows.length === 0 ? (
            <p className="px-6 py-10 text-[13px] text-[var(--ink-3)]">No activity indexed yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {rows.map((r) => {
                const [a1, a2] = (r.asset ?? '').split(':');
                const A1 = findAsset(assets, a1);
                const A2 = a2 ? findAsset(assets, a2) : undefined;
                const label = r.kind === 'shield' ? 'Shield' : r.kind === 'unshield' ? 'Unshield' : r.kind === 'swap' ? 'Swap intent' : 'Batch cleared';
                return (
                  <li key={r.id} className="grid items-center gap-3 px-6 py-3 text-[13px] md:grid-cols-[120px_1fr_auto]">
                    <span className="label whitespace-nowrap">{label}</span>
                    <span className="tabular whitespace-nowrap text-[var(--ink-2)]">
                      {r.amount ? formatAmount(BigInt(r.amount), A1?.decimals ?? 18) : ''} {A1?.symbol ?? (a1 ? short(a1) : '')}
                      {A2 ? ` → ${A2.symbol}` : ''}
                    </span>
                    <TxLink hash={r.tx} chainId={w.chainId} label={new Date(r.ts * 1000).toLocaleTimeString()} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="bg-[var(--bg)] md:col-span-5">
          <div className="border-b border-[var(--line)] px-6 py-4">
            <span className="label">Your notes · private</span>
          </div>
          {mine.length === 0 ? (
            <p className="px-6 py-10 text-[13px] text-[var(--ink-3)]">No notes yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {mine.map((n) => {
                const a = findAsset(assets, n.asset);
                const spent = w.sync.nullifiers.has(n.nullifier);
                return (
                  <li key={n.leafIndex} className={`grid grid-cols-[60px_1fr_auto] items-center gap-3 px-6 py-3 text-[13px] ${spent ? 'opacity-40' : ''}`}>
                    <span className="label">#{n.leafIndex}</span>
                    <span className="tabular">
                      {formatAmount(n.amount, a?.decimals ?? 18)} {a?.symbol ?? '?'}
                      {n.memo ? <span className="ml-2 text-[var(--ink-3)]">“{n.memo}”</span> : null}
                    </span>
                    <span className="label">{spent ? 'spent' : n.amount === 0n ? 'dummy' : 'unspent'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

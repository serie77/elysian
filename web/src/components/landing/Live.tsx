'use client';

import { useEffect, useState } from 'react';
import { nodeApi, type ActivityRow, type NodeState } from '@/lib/node';
import { Reveal } from '../motion/Reveal';
import { Section } from './Section';

const kinds: Record<ActivityRow['kind'], string> = { shield: 'Shield', unshield: 'Unshield', swap: 'Swap intent', batch: 'Batch cleared' };

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** What the pool looks like from the outside, straight from a node. Everything here is public by construction. */
export function Live() {
  const [state, setState] = useState<NodeState | null>(null);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [s, a] = await Promise.all([nodeApi.state(), nodeApi.activity(8)]);
        if (!live) return;
        setState(s);
        setRows(a.rows);
        setOnline(true);
      } catch {
        if (live) setOnline(false);
      }
    };
    void load();
    const t = setInterval(load, 6000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const tiles = [
    { k: 'Private notes', v: state?.poolLeaves },
    { k: 'Notes spent', v: state?.counts.nullifiers },
    { k: 'Sealed swaps', v: state?.counts.swaps },
    { k: 'Batches cleared', v: state?.counts.batches },
  ];

  return (
    <Section id="live" tag="Live" title={[{ t: 'Live from the pool.' }, { t: 'No names attached.', soft: true }]} lede="This is everything the chain can see. No addresses, no balances, no owners.">
      <div className="grid gap-px bg-[var(--line)] md:grid-cols-12">
        <Reveal cascade step={80} className="grid grid-cols-2 gap-px bg-[var(--line)] md:col-span-5 md:grid-cols-2">
          {tiles.map((t) => (
            <div key={t.k} className="will-reveal bg-[rgba(8,7,12,0.85)] p-6">
              <div className="h2 tabular text-[clamp(2rem,3.4vw,3rem)]">{t.v ?? '–'}</div>
              <div className="mt-2 text-[13px] font-medium text-[var(--ink-3)]">{t.k}</div>
            </div>
          ))}
        </Reveal>
        <Reveal delay={200} className="min-w-0 bg-[rgba(8,7,12,0.85)] md:col-span-7">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
            <span className="label">Public log</span>
            <span className="flex items-center gap-2">
              <span className="live-dot" style={{ background: online ? 'var(--green)' : 'var(--ink-4)', animation: online ? undefined : 'none' }} />
              <span className="label">{online === null ? 'connecting' : online ? `block ${state?.lastBlock}` : 'node offline'}</span>
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="px-6 py-10 text-[13px] leading-[1.6] text-[var(--ink-3)]">
              {online ? 'Nothing yet. Shield something.' : 'No node connected.'}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {rows.map((r) => (
                <li key={r.id} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 px-6 py-3 text-[13px]">
                  <span className="label">{kinds[r.kind]}</span>
                  <span className="mono truncate text-[12px] text-[var(--ink-2)]">{r.tx}</span>
                  <span className="label tabular">{ago(r.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </Reveal>
      </div>
    </Section>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { Wordmark } from '../ui/Mark';
import { Connect } from './Connect';
import { useShielded } from '@/lib/wallet/store';
import { shortenAddress } from '@elysian/core';
import { warmProver } from '@/lib/wallet/prover';

const nav = [
  { href: '/app', label: 'Overview', n: '00' },
  { href: '/app/shield', label: 'Shield', n: '01' },
  { href: '/app/send', label: 'Send', n: '02' },
  { href: '/app/trade', label: 'Trade', n: '03' },
  { href: '/app/keys', label: 'Keys', n: '04' },
  { href: '/app/activity', label: 'Activity', n: '05' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { isConnected } = useAccount();
  const w = useShielded();

  useEffect(() => {
    warmProver();
  }, []);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      <aside className="flex flex-col border-b border-[var(--line)] md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r">
        <div className="flex h-16 items-center justify-between px-5 md:px-6">
          <Link href="/" aria-label="Elysian home" className="flex items-center">
            <Wordmark size={20} />
          </Link>
          <div className="md:hidden">
            <Connect />
          </div>
        </div>
        <nav className="scrollbar-thin flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pt-4">
          {nav.map((item) => {
            const active = path === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex shrink-0 items-center gap-3 rounded-[2px] px-3 py-2 text-[13px] transition-colors duration-300 ${
                  active ? 'bg-[var(--surface-2)] text-[var(--ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'
                }`}
              >
                <span className={`label text-[10px] ${active ? 'text-[var(--bone-2)]' : ''}`}>{item.n}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden space-y-3 border-t border-[var(--line)] p-5 md:block">
          <div className="flex items-center gap-2">
            <span className={`live-dot ${w.nodeOnline ? '' : 'opacity-30 [animation:none]'}`} style={{ background: w.nodeOnline ? 'var(--green)' : 'var(--ink-4)' }} />
            <span className="label">{w.nodeOnline ? 'node online' : 'node unreachable'}</span>
          </div>
          {w.sync.state ? (
            <dl className="mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-[var(--ink-3)]">
              <dt>block</dt>
              <dd className="tabular text-right text-[var(--ink-2)]">{w.sync.state.lastBlock}</dd>
              <dt>notes</dt>
              <dd className="tabular text-right text-[var(--ink-2)]">{w.sync.state.poolLeaves}</dd>
              <dt>batch</dt>
              <dd className="tabular text-right text-[var(--ink-2)]">{w.sync.state.currentBatch}</dd>
            </dl>
          ) : null}
        </div>
      </aside>

      <div className="min-w-0">
        <div className="sticky top-0 z-30 hidden h-16 items-center justify-between border-b border-[var(--line)] bg-[rgba(8,7,12,0.8)] px-8 backdrop-blur-md md:flex">
          <div className="flex items-center gap-3">
            {w.address ? (
              <>
                <span className="label">shielded</span>
                <span className="mono text-[12px] text-[var(--ink-2)]">{shortenAddress(w.address, 16, 8)}</span>
              </>
            ) : isConnected ? (
              <span className="text-[13px] text-[var(--ink-3)]">No shielded keys this session</span>
            ) : (
              <span className="text-[13px] text-[var(--ink-3)]">Connect a wallet on Robinhood Chain</span>
            )}
          </div>
          <Connect />
        </div>
        <main className="mx-auto w-full max-w-[1120px] px-5 py-8 md:px-10 md:py-12">{children}</main>
      </div>
    </div>
  );
}

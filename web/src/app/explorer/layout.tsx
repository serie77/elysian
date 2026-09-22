'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { explorerApi } from '@/lib/explorer';
import { Wordmark } from '@/components/ui/Mark';

const tabs = [
  { href: '/explorer', label: 'Home' },
  { href: '/explorer/txs', label: 'Transactions' },
  { href: '/explorer/batches', label: 'Batches' },
  { href: '/explorer/notes', label: 'Notes' },
  { href: '/explorer/view', label: 'Viewing Key' },
];

export default function ExplorerLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    explorerApi.summary().then((s) => setChainId(s.chainId)).catch(() => setChainId(null));
  }, []);
  const network = chainId === 4663 ? 'Mainnet' : chainId === 46630 ? 'Testnet' : chainId === 31337 ? 'Local devnet' : null;

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = query.trim().toLowerCase();
    setError('');
    if (!/^0x[0-9a-f]{64}$/.test(v)) return setError('Enter a 32-byte hash: transaction, commitment or nullifier');
    try {
      await explorerApi.tx(v);
      router.push(`/explorer/tx/${v}`);
    } catch {
      explorerApi.find(v).then((hit) => router.push(`/explorer/tx/${hit.tx}`)).catch(() => setError('No match found'));
    }
  };

  return (
    <div className="ex min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg)]">
        <div className="ex-wrap flex h-14 items-center gap-6">
          <div className="flex flex-none items-center gap-3">
            <Link href="/" aria-label="Elysian home" className="flex items-center">
              <Wordmark size={24} />
            </Link>
            <Link href="/explorer" className="border-l border-[var(--line-strong)] pl-3 text-[13px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]">
              Explorer
            </Link>
          </div>
          <form onSubmit={search} className="relative hidden min-w-0 flex-1 md:block">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by Txn Hash / Commitment / Nullifier" spellCheck={false} className="ex-search" />
            {error ? <span className="absolute left-0 top-full mt-1 text-[12px] text-[var(--danger)]">{error}</span> : null}
          </form>
          {network ? (
            <span className="hidden flex-none items-center gap-2 text-[12.5px] text-[var(--ink-2)] lg:flex" title={chainId === 31337 ? 'A simulated chain on this machine. Tokens and balances here are test data.' : undefined}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: chainId === 4663 ? 'var(--green)' : 'var(--ink-2)' }} />
              {network}
            </span>
          ) : null}
          <nav className="ml-auto flex flex-none items-center gap-1 lg:ml-0">
            <Link href="/" className="ex-tab">Site</Link>
            <Link href="/app" className="ex-tab">App</Link>
          </nav>
        </div>
        <div className="ex-wrap ex-tabs flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = t.href === '/explorer' ? path === '/explorer' : path.startsWith(t.href) || (t.href === '/explorer/txs' && path.startsWith('/explorer/tx/'));
            return (
              <Link key={t.href} href={t.href} className={`ex-nav ${active ? 'is-active' : ''}`}>
                {t.label}
              </Link>
            );
          })}
        </div>
      </header>
      <form onSubmit={search} className="ex-wrap pt-4 md:hidden">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by Txn Hash / Commitment / Nullifier" spellCheck={false} className="ex-search" />
        {error ? <span className="mt-1 block text-[12px] text-[var(--danger)]">{error}</span> : null}
      </form>
      <main className="ex-wrap py-6 md:py-8">{children}</main>
      <footer className="border-t border-[var(--line)]">
        <div className="ex-wrap flex flex-wrap items-center justify-between gap-3 py-5 text-[12px] text-[var(--ink-3)]">
          <span>Elysian Explorer</span>
          <span>Indexed by the Elysian node</span>
        </div>
      </footer>
    </div>
  );
}

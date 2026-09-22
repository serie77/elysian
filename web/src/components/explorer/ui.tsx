'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { formatAmount, short } from '@/lib/assets';
import { age, type TokenRef, type TxKind } from '@/lib/explorer';
import { TokenIcon } from '../ui/TokenIcon';

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ex-card ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      aria-label="Copy"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="ml-1.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        {done ? <path d="M3 8.5l3.2 3.2L13 5" /> : <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>}
      </svg>
    </button>
  );
}

/** A transaction hash: shortened in tables, full on detail pages, always a link, always copyable. */
export function TxHash({ hash, full = false }: { hash: string; full?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center">
      <Link href={`/explorer/tx/${hash}`} className="ex-link mono truncate">
        {full ? hash : short(hash, 8)}
      </Link>
      <Copy value={hash} />
    </span>
  );
}

/** An address, linked out to the chain's own explorer, with our label when it is one of ours. */
export function Address({ address, label, chainUrl, full = false }: { address: string; label?: string | null; chainUrl: string; full?: boolean }) {
  const text = label ?? (full ? address : short(address, 6));
  return (
    <span className="inline-flex min-w-0 items-center">
      {chainUrl ? (
        <a href={`${chainUrl}/address/${address}`} target="_blank" rel="noreferrer" className={`ex-link truncate ${label ? '' : 'mono'}`} title={address}>
          {text}
        </a>
      ) : (
        <span className={`truncate ${label ? '' : 'mono'}`} title={address}>{text}</span>
      )}
      <Copy value={address} />
    </span>
  );
}

export const Method = ({ method }: { kind?: TxKind; method: string }) => <span className="ex-method">{method}</span>;

/** A small coloured dot and a word. The only status decoration the explorer uses. */
export const Dot = ({ tone, children }: { tone: 'ok' | 'bad' | 'idle'; children: ReactNode }) => (
  <span className="inline-flex items-center gap-2 whitespace-nowrap">
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--danger)' : 'var(--ink-4)' }} />
    {children}
  </span>
);

export const Status = ({ status }: { status: 'success' | 'reverted' }) => <Dot tone={status === 'success' ? 'ok' : 'bad'}>{status === 'success' ? 'Success' : 'Failed'}</Dot>;

/** A small grey word after a value: Relayer, Executor, Elysian: Pool. */
export const Tag = ({ children }: { children: ReactNode }) => <span className="whitespace-nowrap text-[12px] text-[var(--ink-3)]">{children}</span>;

/** A field the chain does not contain. */
export const Shielded = ({ w = 72, label = false }: { w?: number; label?: boolean }) => (
  <span className="inline-flex items-center gap-2.5 align-middle" title="Shielded: not published on-chain">
    <span className="bar opacity-60" style={{ width: w, height: 9 }} />
    {label ? <span className="text-[12.5px] text-[var(--ink-3)]">Shielded</span> : null}
  </span>
);

export function Amount({ raw, token, icon = true }: { raw: string | null | undefined; token: TokenRef | null; icon?: boolean }) {
  if (!token) return <span className="text-[var(--ink-3)]">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {raw ? <span className="mono tabular">{formatAmount(BigInt(raw), token.decimals, 6)}</span> : <Shielded w={52} />}
      {icon ? <TokenIcon symbol={token.symbol} size={16} /> : null}
      <span className="font-medium">{token.symbol}</span>
    </span>
  );
}

export const Token = ({ token }: { token: TokenRef }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
    <TokenIcon symbol={token.symbol} size={16} /> {token.symbol}
  </span>
);

export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export const Age = ({ ts, now }: { ts: number; now: number }) => (
  <span className="whitespace-nowrap text-[var(--ink-2)]" title={new Date(ts * 1000).toUTCString()}>
    {age(ts, now)}
  </span>
);

export function Pager({ total, offset, size, onChange }: { total: number; offset: number; size: number; onChange: (offset: number) => void }) {
  const pageNo = Math.floor(offset / size) + 1;
  const pages = Math.max(1, Math.ceil(total / size));
  const Btn = ({ to, children, disabled }: { to: number; children: ReactNode; disabled: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(to)} className="ex-page-btn">
      {children}
    </button>
  );
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-5 py-3 text-[12.5px] text-[var(--ink-3)]">
      <span>
        Showing {total ? offset + 1 : 0} to {Math.min(total, offset + size)} of {total.toLocaleString('en-US')}
      </span>
      <span className="flex items-center gap-1.5">
        <Btn to={0} disabled={pageNo === 1}>First</Btn>
        <Btn to={Math.max(0, offset - size)} disabled={pageNo === 1}>‹</Btn>
        <span className="px-2">Page {pageNo} of {pages}</span>
        <Btn to={offset + size} disabled={pageNo >= pages}>›</Btn>
        <Btn to={(pages - 1) * size} disabled={pageNo >= pages}>Last</Btn>
      </span>
    </div>
  );
}

/** Label and value row of a detail page. */
export function Row({ k, hint, children }: { k: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-3 md:grid-cols-[260px_1fr] md:gap-6">
      <dt className="flex items-center gap-1.5 text-[13.5px] text-[var(--ink-3)]" title={hint}>
        {hint ? <span className="inline-flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border border-[var(--ink-4)] text-[9px]">?</span> : null}
        {k}:
      </dt>
      <dd className="min-w-0 text-[13.5px]">{children}</dd>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="px-5 py-10 text-center text-[13.5px] text-[var(--ink-3)]">{children}</p>;

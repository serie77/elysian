'use client';

import { useEffect, useState } from 'react';
import type { Asset } from '@/lib/assets';
import type { ProveProgress } from '@/lib/wallet/prover';
import { explorerFor } from '@/lib/chains';

export function PageHead({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <header className="mb-10">
      <div className="label mb-4">
        <span className="text-[var(--bone-2)]">{n}</span>
        <span className="mx-3 inline-block h-px w-5 translate-y-[-3px] bg-[var(--line-strong)]" />
        {title}
      </div>
      <p className="max-w-[60ch] text-[15px] leading-[1.6] text-[var(--ink-2)]">{sub}</p>
    </header>
  );
}

const CUSTOM = '__custom__';

export function AssetSelect({
  assets,
  value,
  onChange,
  label = 'Asset',
  exclude,
  onAdd,
}: {
  assets: Asset[];
  value: string;
  onChange: (a: string) => void;
  label?: string;
  exclude?: string;
  /** When provided, the picker offers "Any token by address" and calls this to resolve it. */
  onAdd?: (address: string) => Promise<Asset>;
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const filtered = assets.filter((a) => a.address !== exclude && (q === '' || `${a.symbol} ${a.name}`.toLowerCase().includes(q.toLowerCase())));

  async function add() {
    if (!onAdd) return;
    setBusy(true);
    setErr(null);
    try {
      const a = await onAdd(addr.trim());
      onChange(a.address);
      setAdding(false);
      setAddr('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <span className="text-[13px] text-[var(--ink-3)]">{label}</span>
      {assets.length > 12 ? <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol or name" spellCheck={false} /> : null}
      <select
        value={adding ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setAdding(true);
            onChange('');
          } else {
            setAdding(false);
            onChange(e.target.value);
          }
        }}
        className="appearance-none"
      >
        <option value="">Select</option>
        {filtered.map((a) => (
          <option key={a.address} value={a.address}>
            {a.symbol} · {a.name}
            {a.kind === 'custom' ? ' · added' : ''}
          </option>
        ))}
        {onAdd ? <option value={CUSTOM}>Any token by address…</option> : null}
      </select>
      {adding ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… ERC-20 address on this chain" spellCheck={false} autoComplete="off" className="mono flex-1 text-[12px]" />
            <button type="button" className="btn h-12 px-4 text-[12px]" disabled={busy || !addr} onClick={() => void add()}>
              {busy ? 'Reading' : 'Add'}
            </button>
          </div>
          {err ? <span className="text-[12px] text-[var(--danger)]">{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AmountField({ value, onChange, symbol, max, onMax, label = 'Amount' }: { value: string; onChange: (v: string) => void; symbol?: string; max?: string; onMax?: () => void; label?: string }) {
  return (
    <div className="field">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-[var(--ink-3)]">{label}</span>
        {max !== undefined ? (
          <button type="button" className="label text-[10px] hover:text-[var(--ink)]" onClick={onMax}>
            max {max} {symbol}
          </button>
        ) : null}
      </div>
      <div className="relative">
        <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder="0.0" className="w-full pr-16" />
        {symbol ? <span className="label pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">{symbol}</span> : null}
      </div>
    </div>
  );
}

export function Progress({ p, ms }: { p: ProveProgress | null; ms?: number }) {
  if (!p && !ms) return null;
  const width = p ? (p.stage === 'loading' ? p.progress * 100 : 100) : 100;
  const text = ms ? `Proved in ${(ms / 1000).toFixed(1)} s` : p?.stage === 'loading' ? `Loading proving key ${Math.round(p.progress * 100)}%` : 'Generating proof';
  return (
    <div className="space-y-2">
      <div className="h-px w-full bg-[var(--line)]">
        <div className="h-px bg-[var(--bone)] transition-[width] duration-300" style={{ width: `${width}%` }} />
      </div>
      <div className="label">{text}</div>
    </div>
  );
}

export function TxLink({ hash, chainId, label = 'View transaction' }: { hash: `0x${string}`; chainId: number; label?: string }) {
  const base = explorerFor(chainId);
  if (!base) {
    return (
      <span className="mono whitespace-nowrap text-[12px] text-[var(--ink-2)]" title={hash}>
        {hash.slice(0, 10)}…{hash.slice(-6)}
      </span>
    );
  }
  return (
    <a href={`${base}/tx/${hash}`} target="_blank" rel="noreferrer" className="text-[13px] text-[var(--bone)] underline-offset-4 hover:underline">
      {label}
    </a>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'ok'; children: React.ReactNode }) {
  const color = kind === 'error' ? 'var(--danger)' : kind === 'ok' ? 'var(--bone)' : 'var(--ink-2)';
  return (
    <div className="border-l border-[var(--line-strong)] pl-4 text-[13px] leading-[1.6]" style={{ color }}>
      {children}
    </div>
  );
}

export function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2 text-[13px]">
      <span className="text-[var(--ink-3)]">{k}</span>
      <span className="tabular text-right text-[var(--ink)]">{v}</span>
    </div>
  );
}

export function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.floor(to - now));
  return <span className="tabular">{left}s</span>;
}

export function friendlyError(e: unknown): string {
  const m = (e as Error)?.message ?? '';
  if (/rejected|denied/i.test(m)) return 'Transaction declined in wallet.';
  if (/insufficient shielded/i.test(m)) return 'Not enough shielded balance in two notes. Consolidate first by sending to yourself.';
  if (/Blocked/i.test(m)) return 'The recipient is blocklisted for this stock token.';
  if (/NullifierSpent/i.test(m)) return 'One of these notes was already spent. Refresh and try again.';
  if (/UnknownRoot/i.test(m)) return 'The pool moved on. Refresh and try again.';
  if (/BadBatch/i.test(m)) return 'The batch closed while you were proving. Try again.';
  if (/fee below/i.test(m)) return 'Fee is below the relay minimum.';
  if (/missing \/circuits/i.test(m)) return 'Proving artifacts are missing from this deployment.';
  if (/not a Elysian address/i.test(m) || /malformed/i.test(m)) return 'That is not a valid elysian1 address.';
  if (/enter a number/i.test(m)) return 'Enter an amount.';
  if (/node \d+/.test(m) || /fetch/i.test(m)) return 'The Elysian node is unreachable.';
  return m.length < 120 ? m : 'Something went wrong.';
}

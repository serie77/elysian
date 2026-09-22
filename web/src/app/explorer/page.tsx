'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatAmount } from '@/lib/assets';
import { explorerFor } from '@/lib/chains';
import { explorerApi, type BatchRow, type Summary, type TxRow } from '@/lib/explorer';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { BatchTable, TxTable } from '@/components/explorer/tables';
import { Address, Card, Copy, Empty, useNow } from '@/components/explorer/ui';

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">{k}</div>
      <div className="mono tabular mt-1.5 text-[19px] font-medium tracking-[-0.02em]">{v}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-[var(--ink-3)]">{sub}</div> : null}
    </div>
  );
}

export default function ExplorerHome() {
  const [s, setS] = useState<Summary | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [down, setDown] = useState(false);
  const now = useNow();

  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([explorerApi.summary(), explorerApi.txs(8), explorerApi.batches(6)])
        .then(([a, b, c]) => {
          if (!live) return;
          setS(a);
          setTxs(b.rows);
          setBatches(c.rows);
          setDown(false);
        })
        .catch(() => live && setDown(true));
    load();
    const t = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (!s) return <Empty>{down ? 'Node unreachable' : 'Loading'}</Empty>;
  const chainUrl = explorerFor(s.chainId);
  const n = (v: number) => v.toLocaleString('en-US');
  const all = <T extends string>(href: T, label: string) => (
    <Link href={href} className="ex-link text-[12.5px] font-medium">
      {label}
    </Link>
  );

  return (
    <div className="space-y-5">
      <Card>
        <div className="ex-stats">
          <Stat k="Transactions" v={n(s.transactions)} />
          <Stat k="Latest Block" v={n(s.head)} sub={`Indexed to ${n(s.indexed)}`} />
          <Stat k="Notes" v={n(s.totals.notes)} sub={`${n(s.totals.spent)} nullifiers`} />
          <Stat k="Current Batch" v={s.currentBatch} sub={`${s.batchDuration}s window · ${n(s.totals.batches)} cleared`} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title="Pool Holdings">
          {s.pooled.length ? (
            <div>
              <table className="ex-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Contract</th>
                    <th className="text-right">Shielded Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {s.pooled.map((t) => (
                    <tr key={t.address}>
                      <td>
                        <span className="inline-flex items-center gap-2 font-medium">
                          <TokenIcon symbol={t.symbol} size={20} /> {t.symbol}
                        </span>
                      </td>
                      <td><Address address={t.address} chainUrl={chainUrl} /></td>
                      <td className="mono tabular text-right">{formatAmount(BigInt(t.balance), t.decimals, 6) === '0' ? '< 0.000001' : formatAmount(BigInt(t.balance), t.decimals, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nothing shielded yet</Empty>
          )}
        </Card>

        <Card title="Protocol">
          <dl className="divide-y divide-[var(--line)] text-[13px]">
            {(
              [
                ['Pool', s.contracts.pool],
                ['Swap', s.contracts.swap],
                ['Venue Adapter', s.contracts.dex],
              ] as const
            ).map(([k, a]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-5 py-2.5">
                <dt className="text-[var(--ink-3)]">{k}</dt>
                <dd><Address address={a} chainUrl={chainUrl} /></dd>
              </div>
            ))}
            {(
              [
                ['Note Tree Root', s.poolRoot],
                ['Order Tree Root', s.swapRoot],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-5 py-2.5">
                <dt className="text-[var(--ink-3)]">{k}</dt>
                <dd className="mono inline-flex items-center">{`${v.slice(0, 10)}…${v.slice(-8)}`}<Copy value={v} /></dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 px-5 py-2.5">
              <dt className="text-[var(--ink-3)]">Chain ID</dt>
              <dd className="mono">{s.chainId}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-5 2xl:grid-cols-2">
        <Card title="Latest Transactions" action={all('/explorer/txs', 'View all')}>
          <TxTable rows={txs} now={now} chainUrl={chainUrl} compact />
        </Card>
        <Card title="Latest Batches" action={all('/explorer/batches', 'View all')}>
          <BatchTable rows={batches} now={now} compact />
        </Card>
      </div>
    </div>
  );
}

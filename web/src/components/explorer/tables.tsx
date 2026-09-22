'use client';

import { formatAmount } from '@/lib/assets';
import { eth, type BatchRow, type TxRow } from '@/lib/explorer';
import { TokenIcon } from '../ui/TokenIcon';
import { Address, Age, Amount, Dot, Empty, Method, Shielded, Tag, TxHash } from './ui';

/*
 * No table scrolls. Columns drop out as the viewport narrows instead (the c-* classes), and the
 * compact variants used side by side on the home page keep only what fits in half the width.
 */
const C = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell', xxl: 'hidden 2xl:table-cell' };

export function TxTable({ rows, now, chainUrl, compact = false }: { rows: TxRow[]; now: number; chainUrl: string; compact?: boolean }) {
  if (!rows.length) return <Empty>No transactions yet</Empty>;
  return (
    <table className={`ex-table ${compact ? 'ex-table-compact' : ''}`}>
      <thead>
        <tr>
          <th>Txn Hash</th>
          <th>Method</th>
          {compact ? null : <th className={C.xl}>Block</th>}
          <th className={C.sm}>Age</th>
          {compact ? null : <th className={C.lg}>From</th>}
          {compact ? null : <th className={C.xxl}>To</th>}
          <th>Amount</th>
          {compact ? null : <th className={`${C.xl} text-right`}>Txn Fee</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.tx}>
            <td><TxHash hash={r.tx} /></td>
            <td><Method method={r.method} /></td>
            {compact ? null : <td className={`${C.xl} mono tabular`}>{r.block.toLocaleString('en-US')}</td>}
            <td className={C.sm}><Age ts={r.ts} now={now} /></td>
            {compact ? null : (
              <td className={C.lg}>
                <span className="inline-flex items-center gap-2">
                  <Address address={r.from} chainUrl={chainUrl} />
                  {r.fromLabel ? <span className="hidden xl:inline"><Tag>{r.fromLabel}</Tag></span> : null}
                </span>
              </td>
            )}
            {compact ? null : <td className={C.xxl}>{r.to ? <Address address={r.to} label={r.toLabel} chainUrl={chainUrl} /> : '–'}</td>}
            <td>
              <Amount raw={r.amount} token={r.asset} />
              {r.assetOut ? <span className="ml-1.5 hidden text-[var(--ink-3)] sm:inline">for {r.assetOut.symbol}</span> : null}
            </td>
            {compact ? null : <td className={`${C.xl} mono tabular text-right text-[var(--ink-2)]`}>{eth(r.fee)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const price = (b: { executed: boolean; refunded?: boolean; totalIn: string; totalOut: string; assetIn: { decimals: number }; assetOut: { decimals: number } }) =>
  b.executed && !b.refunded && b.totalIn !== '0' ? Number(formatAmount(BigInt(b.totalOut), b.assetOut.decimals, 8).replace(/,/g, '')) / Number(formatAmount(BigInt(b.totalIn), b.assetIn.decimals, 8).replace(/,/g, '')) : 0;

export function BatchTable({ rows, now, compact = false }: { rows: BatchRow[]; now: number; compact?: boolean }) {
  if (!rows.length) return <Empty>No batches yet</Empty>;
  return (
    <table className={`ex-table ${compact ? 'ex-table-compact' : ''}`}>
      <thead>
        <tr>
          <th>Batch</th>
          <th>Pair</th>
          <th className={C.sm}>Status</th>
          {compact ? null : <th className={C.xxl}>Opened</th>}
          {compact ? null : <th className={C.md}>Orders</th>}
          <th>Sold</th>
          <th className={C.sm}>Bought</th>
          {compact ? null : <th className={C.xl}>Clearing Price</th>}
          {compact ? null : <th className={C.xxl}>Traders</th>}
          {compact ? null : <th className={C.lg}>Execution Txn</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => {
          const p = price(b);
          return (
            <tr key={`${b.batchId}${b.assetIn.address}${b.assetOut.address}`}>
              <td className="mono tabular">{b.batchId}</td>
              <td>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
                  <TokenIcon symbol={b.assetIn.symbol} size={16} /> {b.assetIn.symbol} <span className="text-[var(--ink-3)]">/</span> <TokenIcon symbol={b.assetOut.symbol} size={16} /> {b.assetOut.symbol}
                </span>
              </td>
              <td className={C.sm}><Dot tone={b.executed ? 'ok' : 'idle'}>{b.refunded ? 'Refunded' : b.executed ? 'Cleared' : 'Open'}</Dot></td>
              {compact ? null : <td className={C.xxl}><Age ts={b.opens} now={now} /></td>}
              {compact ? null : <td className={`${C.md} mono tabular`}>{b.orders}</td>}
              <td><Amount raw={b.totalIn} token={b.assetIn} icon={false} /></td>
              <td className={C.sm}>{b.executed && !b.refunded ? <Amount raw={b.totalOut} token={b.assetOut} icon={false} /> : '–'}</td>
              {compact ? null : <td className={`${C.xl} mono tabular whitespace-nowrap`}>{p ? `${p.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${b.assetOut.symbol}` : '–'}</td>}
              {compact ? null : <td className={C.xxl}><Shielded w={48} /></td>}
              {compact ? null : <td className={C.lg}>{b.tx ? <TxHash hash={b.tx} /> : '–'}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

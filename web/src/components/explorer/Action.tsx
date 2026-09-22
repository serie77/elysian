'use client';

import type { ReactNode } from 'react';
import type { TxDetail } from '@/lib/explorer';
import { price } from './tables';
import { Address, Amount, Card, Shielded, Token } from './ui';

const POOL = 'Elysian: Pool';

/** What a transaction did, step by step, in the order it happened. Hidden quantities stay bars. */
export function TxAction({ d, chainUrl }: { d: TxDetail; chainUrl: string }) {
  const noteIds = d.commitments.map((c) => `#${c.idx}`).join(', ');
  const dim = (t: ReactNode) => <span className="dim">{t}</span>;
  const spent = d.nullifiers.length ? (
    <li key="spent">
      Spent up to {d.nullifiers.length} shielded {d.nullifiers.length === 1 ? 'note' : 'notes'} {dim('of')} {d.asset ? <Token token={d.asset} /> : null} {dim('worth')} <Shielded w={48} />
    </li>
  ) : null;
  const created = (why: string) =>
    d.commitments.length ? (
      <li key="created">
        Created {d.commitments.length === 1 ? 'note' : 'notes'} <span className="mono">{noteIds}</span> {dim(why)}
      </li>
    ) : null;
  const relayed =
    d.relayer && d.fromLabel === 'Relayer' ? (
      <li key="relay">
        Submitted by relayer <Address address={d.relayer} chainUrl={chainUrl} /> {dim('for')} {d.relayerFee ? <Amount raw={d.relayerFee} token={d.asset} /> : dim('no fee')}
      </li>
    ) : null;
  const rate = d.batch ? price(d.batch) : 0;
  const rateText = d.batch && rate ? `${rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${d.batch.assetOut.symbol} per ${d.batch.assetIn.symbol}` : null;

  let headline: ReactNode;
  let steps: ReactNode[];
  switch (d.kind) {
    case 'shield':
      headline = <>Shield <Amount raw={d.amount} token={d.asset} /> {dim('into')} {POOL}</>;
      steps = [
        <li key="in">
          Deposited <Amount raw={d.amount} token={d.asset} /> {dim('from')} <Address address={d.from} chainUrl={chainUrl} /> {dim('into')} {POOL}
        </li>,
        created('holding the deposit. The owner is shielded'),
      ];
      break;
    case 'unshield':
      headline = <>Unshield <Amount raw={d.amount} token={d.asset} /> {dim('to')} {d.recipient ? <Address address={d.recipient} chainUrl={chainUrl} /> : null}</>;
      steps = [
        spent,
        <li key="out">
          Withdrew <Amount raw={d.amount} token={d.asset} /> {dim('from')} {POOL} {dim('to')} {d.recipient ? <Address address={d.recipient} chainUrl={chainUrl} /> : null}
        </li>,
        relayed,
        created('for the change'),
      ];
      break;
    case 'transfer':
      headline = <>Private transfer {dim('of')} {d.asset ? <Token token={d.asset} /> : null} <Shielded w={56} /></>;
      steps = [
        spent,
        <li key="move">
          Sent <Shielded w={48} /> {d.asset ? <Token token={d.asset} /> : null} {dim('from')} <Shielded w={64} /> {dim('to')} <Shielded w={64} />
        </li>,
        created('for the recipient and the change'),
        relayed,
      ];
      break;
    case 'swap': {
      const o = d.intents[0];
      headline = <>Sealed order: sell <Amount raw={d.amount} token={d.asset} /> {dim('for')} {d.assetOut ? <Token token={d.assetOut} /> : null}</>;
      steps = [
        spent,
        <li key="move">
          Moved <Amount raw={d.amount} token={d.asset} /> {dim('from')} {POOL} {dim('to')} Elysian: Swap
        </li>,
        <li key="order">
          Placed order <span className="mono">#{o?.index}</span> {dim('in batch')} <span className="mono">{d.batchId}</span> {dim('to buy')} {d.assetOut ? <Token token={d.assetOut} /> : null} {dim('Owner')} <Shielded w={56} />
        </li>,
        d.batch ? (
          <li key="state">
            {d.batch.refunded ? <>Batch cancelled {dim('and the order refunded in full')}</> : d.batch.executed ? <>Batch cleared {dim('at')} {rateText}</> : <>Batch still open {dim(`with ${d.batch.orders} ${d.batch.orders === 1 ? 'order' : 'orders'}`)}</>}
          </li>
        ) : null,
        d.batch && d.batch.executed && d.batch.orders === 1 ? <li key="alone">Only order in its batch {dim('so its output and its claim can be read from the batch totals')}</li> : null,
        created('for the change'),
      ];
      break;
    }
    case 'batch':
      if (d.batch?.refunded) {
        headline = <>Cancelled batch <span className="mono">{d.batchId}</span>: refunded <Amount raw={d.batch.totalIn} token={d.batch.assetIn} /></>;
        steps = [
          <li key="back">
            Returned <Amount raw={d.batch.totalIn} token={d.batch.assetIn} /> {dim('from')} Elysian: Swap {dim('to')} {POOL}
          </li>,
          <li key="claim">Each of the {d.batch.orders} {d.batch.orders === 1 ? 'order' : 'orders'} claims back exactly what it put in</li>,
        ];
        break;
      }
      headline = d.batch ? <>Cleared batch <span className="mono">{d.batchId}</span>: <Amount raw={d.batch.totalIn} token={d.batch.assetIn} /> {dim('for')} <Amount raw={d.batch.totalOut} token={d.batch.assetOut} /></> : <>Cleared batch {d.batchId}</>;
      steps = d.batch
        ? [
            <li key="sell">
              Sold <Amount raw={d.batch.totalIn} token={d.batch.assetIn} /> {dim(`pooled from ${d.batch.orders} sealed ${d.batch.orders === 1 ? 'order' : 'orders'} on the venue`)}
            </li>,
            <li key="buy">
              Received <Amount raw={d.batch.totalOut} token={d.batch.assetOut} /> {dim('into')} {POOL}
            </li>,
            <li key="rate">Clearing price {rateText} {dim('for every order in the batch')}</li>,
            <li key="who">
              Traders <Shielded w={64} /> {dim('Each claims their share separately')}
            </li>,
          ]
        : [];
      break;
    default:
      headline = <>Claim {d.asset ? <Token token={d.asset} /> : null} <Shielded w={56} /> {dim('from batch')} <span className="mono">{d.batchId}</span></>;
      steps = [
        <li key="prove">
          Proved ownership of a sealed order {dim('in batch')} <span className="mono">{d.batchId}</span> {d.batch ? <>({d.batch.assetIn.symbol} {dim('for')} {d.batch.assetOut.symbol})</> : null} {dim('Which order')} <Shielded w={56} />
        </li>,
        d.batch?.refunded ? <li key="rate">Batch was cancelled {dim('so the order is paid back in')} {d.batch.assetIn.symbol}</li> : rateText ? <li key="rate">Paid out {dim('at the batch price of')} {rateText}</li> : null,
        d.batch?.orders === 1 ? <li key="alone">Only order in that batch {dim('so the amount claimed equals the batch output')}</li> : null,
        created(d.batch?.orders === 1 ? 'holding the claimed share. The owner is shielded' : 'holding the claimed share. Amount and owner are shielded'),
      ];
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-4 text-[15px] font-medium tracking-[-0.01em]">{headline}</div>
      <ol className="ex-steps text-[13.5px]">{steps.filter(Boolean)}</ol>
    </Card>
  );
}

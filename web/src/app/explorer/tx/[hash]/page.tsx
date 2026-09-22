'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { explorerFor } from '@/lib/chains';
import { eth, explorerApi, gwei, type Summary, type TxDetail } from '@/lib/explorer';
import { TxAction } from '@/components/explorer/Action';
import { Address, Age, Amount, Card, Copy, Dot, Empty, Method, Row, Shielded, Status, Tag, Token, useNow } from '@/components/explorer/ui';

const TABS = ['Overview', 'Logs', 'Privacy'] as const;

/** Which fields of each transaction type never reach the chain, and which of them this transaction gives away anyway. */
function privacyRows(d: TxDetail): { k: string; note?: string }[] {
  const signer = d.fromLabel === 'Unrelayed' ? 'Submitted without a known relayer, so the signing address may be the owner’s own wallet' : undefined;
  const alone = d.batch?.orders === 1;
  switch (d.kind) {
    case 'shield':
      return [{ k: 'Note owner' }, { k: 'Note blinding' }, { k: 'Later spends of this note' }];
    case 'unshield':
      return [{ k: 'Note owner', note: signer }, { k: 'Which notes were spent' }, { k: 'Remaining balance' }];
    case 'transfer':
      return [{ k: 'Sender', note: signer }, { k: 'Recipient' }, { k: 'Amount' }, { k: 'Memo' }];
    case 'swap':
      return [{ k: 'Order owner', note: signer }, { k: 'Remaining balance' }];
    case 'batch':
      return [
        { k: 'Traders in the batch', note: alone ? 'One order, so one trader' : undefined },
        { k: 'Each trader’s share', note: alone ? 'The whole batch' : undefined },
      ];
    default:
      return [
        { k: 'Claimant', note: signer },
        { k: 'Which order is claimed', note: alone ? 'The batch held one order' : undefined },
        { k: 'Amount received', note: alone ? 'Equal to the batch output' : undefined },
      ];
  }
}

export default function TxPage() {
  const { hash } = useParams<{ hash: string }>();
  const [d, setD] = useState<TxDetail | null>(null);
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [showInput, setShowInput] = useState(false);
  const now = useNow();

  useEffect(() => {
    setD(null);
    setError('');
    Promise.all([explorerApi.tx(hash), explorerApi.summary()])
      .then(([a, b]) => {
        setD(a);
        setS(b);
      })
      .catch((e: Error) => setError(e.message === 'Not found' ? 'This hash is not an Elysian transaction' : e.message));
  }, [hash]);

  if (error) return <Empty>{error}</Empty>;
  if (!d || !s) return <Empty>Loading</Empty>;
  const chainUrl = explorerFor(s.chainId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Transaction Details</h1>
      </div>

      <div className="flex gap-1 border-b border-[var(--line)]">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`ex-nav ${tab === t ? 'is-active' : ''}`}>
            {t}
            {t === 'Logs' ? ` (${d.logs.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'Overview' ? (
        <>
          <TxAction d={d} chainUrl={chainUrl} />

          <Card>
            <dl className="divide-y divide-[var(--line)]">
              <Row k="Transaction Hash" hint="Unique identifier of this transaction on the chain">
                <span className="mono inline-flex items-center break-all">{d.tx}<Copy value={d.tx} /></span>
                {chainUrl ? (
                  <a href={`${chainUrl}/tx/${d.tx}`} target="_blank" rel="noreferrer" className="ex-link ml-3 whitespace-nowrap text-[12.5px]">
                    View on chain explorer
                  </a>
                ) : null}
              </Row>
              <Row k="Status"><Status status={d.status} /></Row>
              <Row k="Block" hint="Block this transaction was included in">
                <span className="mono tabular">{d.block.toLocaleString('en-US')}</span>
                <span className="ml-3 text-[var(--ink-3)]">{d.confirmations.toLocaleString('en-US')} L2 block confirmations</span>
              </Row>
              <Row k="Timestamp">
                <Age ts={d.ts} now={now} /> <span className="text-[var(--ink-3)]">({new Date(d.ts * 1000).toUTCString()})</span>
              </Row>
              <Row k="Action"><Method method={d.method} /></Row>
              <Row k="Function" hint="Contract function called">
                <span className="mono">{d.kind === 'batch' ? (d.method === 'Cancel Batch' ? 'cancelBatch' : 'executeBatch') : d.kind === 'claim' ? 'claim' : 'transact'}</span> <span className="mono ml-2 text-[var(--ink-3)]">{d.selector}</span>
              </Row>
            </dl>
          </Card>

          <Card>
            <dl className="divide-y divide-[var(--line)]">
              <Row k="From" hint="The account that signed and paid for the transaction. Relayer: not the owner of the funds. Unrelayed: not a known relayer, so possibly the owner’s own wallet">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Address address={d.from} chainUrl={chainUrl} full />
                  {d.fromLabel ? <Tag>{d.fromLabel}</Tag> : null}
                </span>
              </Row>
              <Row k="Interacted With (To)">{d.to ? <span className="inline-flex flex-wrap items-center gap-2"><Address address={d.to} chainUrl={chainUrl} full />{d.toLabel ? <Tag>{d.toLabel}</Tag> : null}</span> : '–'}</Row>
              {d.transfers.length ? (
                <Row k="ERC-20 Tokens Transferred" hint="Token movements visible to everyone">
                  <div className="space-y-1.5">
                    {d.transfers.map((t, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[var(--ink-3)]">From</span> <Address address={t.from} label={t.fromLabel} chainUrl={chainUrl} />
                        <span className="text-[var(--ink-3)]">To</span> <Address address={t.to} label={t.toLabel} chainUrl={chainUrl} />
                        <span className="text-[var(--ink-3)]">For</span> <Amount raw={t.value} token={t.token} />
                      </div>
                    ))}
                  </div>
                </Row>
              ) : null}
            </dl>
          </Card>

          <Card title="Shielded Action">
            <dl className="divide-y divide-[var(--line)]">
              <Row k="Token" hint="The asset is public on every Elysian transaction">{d.asset ? <span className="inline-flex items-center gap-2"><Token token={d.asset} /><Address address={d.asset.address} chainUrl={chainUrl} /></span> : '–'}</Row>
              <Row k={d.kind === 'swap' ? 'Order Size' : d.kind === 'batch' ? 'Batch Size' : 'Public Amount'} hint="Only deposits, withdrawals and orders state an amount">
                {d.amount ? <Amount raw={d.amount} token={d.asset} /> : <Shielded label />}
              </Row>
              {d.kind === 'unshield' ? <Row k="Withdrawn To">{d.recipient ? <Address address={d.recipient} chainUrl={chainUrl} full /> : '–'}</Row> : null}
              {d.kind === 'transfer' ? <Row k="Sender"><Shielded label /></Row> : null}
              {d.kind === 'transfer' ? <Row k="Recipient"><Shielded label /></Row> : null}
              {d.relayer ? <Row k="Relayer"><Address address={d.relayer} chainUrl={chainUrl} full /></Row> : null}
              {d.relayerFee ? <Row k="Relayer Fee"><Amount raw={d.relayerFee} token={d.asset} /></Row> : null}
              {d.assetOut ? <Row k="Buying"><Token token={d.assetOut} /></Row> : null}
              {d.batchId ? <Row k="Batch"><span className="mono tabular">{d.batchId}</span></Row> : null}
              {d.minOut ? <Row k="Minimum Output" hint="Slippage floor set by the executor"><Amount raw={d.minOut} token={d.assetOut} /></Row> : null}
              {d.intents.map((i) => (
                <Row key={i.index} k={`Order #${i.index}`}>
                  <span className="mono break-all">{i.commitment}</span>
                </Row>
              ))}
              {d.root ? <Row k="Merkle Root" hint="Tree root the proof was checked against"><span className="mono break-all">{d.root}</span></Row> : null}
              {d.extDataHash ? <Row k="Ext Data Hash" hint="Binds the proof to the public fields above"><span className="mono break-all">{d.extDataHash}</span></Row> : null}
              <Row k={`Nullifiers (${d.nullifiers.length})`} hint="Marks a note as spent without revealing which note">
                {d.nullifiers.length ? d.nullifiers.map((n) => <div key={n} className="mono inline-flex w-full items-center break-all">{n}<Copy value={n} /></div>) : '–'}
              </Row>
              <Row k={`Commitments (${d.commitments.length})`} hint="New notes. Leaf index, hash, and size of the encrypted payload">
                {d.commitments.length
                  ? d.commitments.map((m) => (
                      <div key={m.idx} className="flex flex-wrap items-center gap-x-2">
                        <span className="mono tabular w-10 flex-none text-[var(--ink-3)]">#{m.idx}</span>
                        <span className="mono inline-flex items-center break-all">{m.commitment}<Copy value={m.commitment} /></span>
                        <span className="text-[12px] text-[var(--ink-3)]">{Math.max(0, (m.size - 2) / 2)} bytes ciphertext</span>
                      </div>
                    ))
                  : '–'}
              </Row>
              {d.kind !== 'batch' ? <Row k="Zero-Knowledge Proof"><Dot tone="ok">Groth16, verified on-chain</Dot></Row> : null}
            </dl>
          </Card>

          <Card>
            <dl className="divide-y divide-[var(--line)]">
              <Row k="Transaction Fee"><span className="mono tabular">{eth(d.fee, 12)} ETH</span></Row>
              <Row k="Gas Price"><span className="mono tabular">{gwei(d.gasPrice)} Gwei</span></Row>
              <Row k="Gas Limit & Usage">
                <span className="mono tabular">{Number(d.gasLimit).toLocaleString('en-US')} | {Number(d.gasUsed).toLocaleString('en-US')} ({((Number(d.gasUsed) / Number(d.gasLimit)) * 100).toFixed(2)}%)</span>
              </Row>
              <Row k="Nonce / Position"><span className="mono tabular">{d.nonce} / {d.position}</span></Row>
              <Row k="Input Data">
                <button type="button" onClick={() => setShowInput(!showInput)} className="ex-page-btn">
                  {showInput ? 'Hide' : 'Show'} {d.inputSize.toLocaleString('en-US')} bytes
                </button>
                {showInput ? <div className="mono mt-3 whitespace-pre-wrap break-all rounded border border-[var(--line)] bg-[var(--bg)] p-3 text-[12px] leading-[1.6] text-[var(--ink-2)]">{d.input}</div> : null}
              </Row>
            </dl>
          </Card>
        </>
      ) : null}

      {tab === 'Logs' ? (
        <Card title={`Transaction Receipt Event Logs (${d.logs.length})`}>
          {d.logs.length ? (
            <div className="divide-y divide-[var(--line)]">
              {d.logs.map((l) => (
                <div key={l.index} className="grid gap-3 px-5 py-4 md:grid-cols-[56px_1fr]">
                  <span className="mono tabular text-[var(--ink-3)]">{l.index}</span>
                  <div className="min-w-0 space-y-2 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[var(--ink-3)]">Address</span> <Address address={l.address} label={l.label} chainUrl={chainUrl} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[var(--ink-3)]">Name</span> <span className="mono font-medium">{l.name ?? 'Unknown'}</span>
                    </div>
                    {Object.entries(l.args).map(([k, v]) => (
                      <div key={k} className="grid gap-1 md:grid-cols-[150px_1fr]">
                        <span className="mono text-[var(--ink-3)]">{k}</span>
                        <span className="mono break-all text-[var(--ink-2)]">{String(v)}</span>
                      </div>
                    ))}
                    {!l.name ? l.topics.map((t, i) => <div key={t} className="mono break-all text-[var(--ink-2)]"><span className="text-[var(--ink-3)]">topic{i} </span>{t}</div>) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No logs</Empty>
          )}
        </Card>
      ) : null}

      {tab === 'Privacy' ? (
        <Card title="Fields Not Published On-Chain">
          <dl className="divide-y divide-[var(--line)]">
            {privacyRows(d).map((r) => (
              <Row key={r.k} k={r.k}>
                {r.note ? <span className="text-[13px] text-[var(--ink-2)]">{r.note}</span> : <Shielded w={140} label />}
              </Row>
            ))}
          </dl>
        </Card>
      ) : null}
    </div>
  );
}

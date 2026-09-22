'use client';

import { useEffect, useState } from 'react';
import { explorerApi, type NoteRow, type NullifierRow } from '@/lib/explorer';
import { short } from '@/lib/assets';
import { Card, Copy, Empty, Pager, TxHash } from '@/components/explorer/ui';

const SIZE = 25;
const TABS = ['Commitments', 'Nullifiers'] as const;

export default function NotesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Commitments');
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [nulls, setNulls] = useState<NullifierRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let live = true;
    if (tab === 'Commitments') explorerApi.notes(SIZE, offset).then((r) => live && (setNotes(r.rows), setTotal(r.total)));
    else explorerApi.nullifiers(SIZE, offset).then((r) => live && (setNulls(r.rows), setTotal(r.total)));
    return () => {
      live = false;
    };
  }, [tab, offset]);

  return (
    <div className="space-y-4">
      <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Notes</h1>
      <p className="max-w-[80ch] text-[13px] text-[var(--ink-3)]">A note is an encrypted record of a balance, like a sealed banknote. Shields, transfers and claims create notes as commitments; spending one publishes its nullifier.</p>
      <div className="flex gap-1 border-b border-[var(--line)]">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => { setTab(t); setOffset(0); }} className={`ex-nav ${tab === t ? 'is-active' : ''}`}>
            {t}
          </button>
        ))}
      </div>
      <Card title={`${total.toLocaleString('en-US')} ${tab.toLowerCase()} found`}>
        <div>
          <table className="ex-table">
            <thead>
              {tab === 'Commitments' ? (
                <tr><th>Leaf</th><th>Commitment</th><th className="hidden md:table-cell">Ciphertext</th><th className="hidden sm:table-cell">Block</th><th>Txn Hash</th></tr>
              ) : (
                <tr><th>Nullifier</th><th>Block</th><th>Txn Hash</th></tr>
              )}
            </thead>
            <tbody>
              {tab === 'Commitments'
                ? notes.map((r) => (
                    <tr key={r.idx}>
                      <td className="mono tabular">{r.idx}</td>
                      <td><span className="mono inline-flex items-center"><span className="hidden xl:inline">{r.commitment}</span><span className="xl:hidden">{short(r.commitment, 10)}</span><Copy value={r.commitment} /></span></td>
                      <td className="mono tabular hidden whitespace-nowrap md:table-cell">{Math.max(0, (r.size - 2) / 2)} bytes</td>
                      <td className="mono tabular hidden sm:table-cell">{r.block.toLocaleString('en-US')}</td>
                      <td><TxHash hash={r.tx} /></td>
                    </tr>
                  ))
                : nulls.map((r) => (
                    <tr key={r.nullifier}>
                      <td><span className="mono inline-flex items-center"><span className="hidden lg:inline">{r.nullifier}</span><span className="lg:hidden">{short(r.nullifier, 10)}</span><Copy value={r.nullifier} /></span></td>
                      <td className="mono tabular">{r.block.toLocaleString('en-US')}</td>
                      <td><TxHash hash={r.tx} /></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!total ? <Empty>Nothing yet</Empty> : null}
        <Pager total={total} offset={offset} size={SIZE} onChange={setOffset} />
      </Card>
    </div>
  );
}

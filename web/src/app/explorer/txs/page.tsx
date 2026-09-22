'use client';

import { useEffect, useState } from 'react';
import { explorerFor } from '@/lib/chains';
import { explorerApi, type Summary, type TxRow } from '@/lib/explorer';
import { TxTable } from '@/components/explorer/tables';
import { Card, Empty, Pager, useNow } from '@/components/explorer/ui';

const SIZE = 25;

export default function TxsPage() {
  const [rows, setRows] = useState<TxRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [s, setS] = useState<Summary | null>(null);
  const now = useNow();

  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([explorerApi.txs(SIZE, offset), explorerApi.summary()]).then(([t, sum]) => {
        if (!live) return;
        setRows(t.rows);
        setTotal(t.total);
        setS(sum);
      });
    load();
    const timer = setInterval(load, 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [offset]);

  return (
    <div className="space-y-4">
      <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Transactions</h1>
      <Card title={`${total.toLocaleString('en-US')} transactions found`}>
        {rows && s ? <TxTable rows={rows} now={now} chainUrl={explorerFor(s.chainId)} /> : <Empty>Loading</Empty>}
        <Pager total={total} offset={offset} size={SIZE} onChange={setOffset} />
      </Card>
    </div>
  );
}

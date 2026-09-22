'use client';

import { useEffect, useState } from 'react';
import { explorerApi, type BatchRow } from '@/lib/explorer';
import { BatchTable } from '@/components/explorer/tables';
import { Card, Empty, Pager, useNow } from '@/components/explorer/ui';

const SIZE = 25;

export default function BatchesPage() {
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const now = useNow();

  useEffect(() => {
    let live = true;
    const load = () =>
      explorerApi.batches(SIZE, offset).then((b) => {
        if (!live) return;
        setRows(b.rows);
        setTotal(b.total);
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
      <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Trade Batches</h1>
      <Card title={`${total.toLocaleString('en-US')} batches found`}>
        {rows ? <BatchTable rows={rows} now={now} /> : <Empty>Loading</Empty>}
        <Pager total={total} offset={offset} size={SIZE} onChange={setOffset} />
      </Card>
    </div>
  );
}

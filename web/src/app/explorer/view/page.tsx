'use client';

import { useState } from 'react';
import { assetToAddress, decodeViewingKey, hexToBytes, scanCommitments, scanSwaps, type OwnedNote } from '@elysian/core';
import { formatAmount, short } from '@/lib/assets';
import { explorerApi, type TokenRef } from '@/lib/explorer';
import { nodeApi } from '@/lib/node';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { Card, Dot, Empty, TxHash } from '@/components/explorer/ui';

type Note = OwnedNote & { spent: boolean; tx: string; block: number };
interface Order {
  index: number;
  batchId: string;
  assetIn: string;
  assetOut: string;
  amountIn: bigint;
  tx: string;
}

export default function ViewPage() {
  const [key, setKey] = useState('');
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tokens, setTokens] = useState<Map<string, TokenRef>>(new Map());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const scan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const fvk = decodeViewingKey(key.trim());
      const [commitments, spent, swaps, summary, txs] = await Promise.all([nodeApi.allCommitments(), nodeApi.nullifiers(), nodeApi.allSwaps(), explorerApi.summary(), explorerApi.txs(100)]);
      const known = new Map<string, TokenRef>();
      summary.pooled.forEach((t) => known.set(t.address, t));
      txs.rows.forEach((r) => [r.asset, r.assetOut].forEach((t) => t && known.set(t.address, t)));
      setTokens(known);
      const spentSet = new Set(spent.rows.map((n) => BigInt(n)));
      const at = new Map(commitments.map((r) => [r.index, r]));
      const owned = scanCommitments(fvk, commitments.map((r) => ({ commitment: BigInt(r.commitment), index: r.index, ciphertext: hexToBytes(r.ciphertext) })));
      setNotes(owned.filter((n) => n.amount > 0n).map((n) => ({ ...n, spent: spentSet.has(n.nullifier), tx: at.get(n.leafIndex)?.tx ?? '', block: at.get(n.leafIndex)?.block ?? 0 })));
      const mine = scanSwaps(fvk, swaps.map((r) => ({ commitment: BigInt(r.commitment), index: r.index, batchId: BigInt(r.batchId), assetIn: BigInt(r.assetIn), assetOut: BigInt(r.assetOut), amountIn: BigInt(r.amountIn), ciphertext: hexToBytes(r.ciphertext) })));
      const swapTx = new Map(swaps.map((r) => [r.index, r.tx]));
      setOrders(mine.map((o) => ({ index: o.leafIndex, batchId: o.batchId.toString(), assetIn: assetToAddress(o.assetIn), assetOut: assetToAddress(o.assetOut), amountIn: o.amountIn, tx: swapTx.get(o.leafIndex) ?? '' })));
    } catch {
      setNotes(null);
      setError('Invalid viewing key');
    }
    setBusy(false);
  };

  const sym = (address: string) => tokens.get(address.toLowerCase());
  const balances = new Map<string, bigint>();
  notes?.filter((n) => !n.spent).forEach((n) => balances.set(assetToAddress(n.asset), (balances.get(assetToAddress(n.asset)) ?? 0n) + n.amount));

  return (
    <div className="space-y-4">
      <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Viewing Key</h1>
      <Card>
        <form onSubmit={scan} className="flex flex-col gap-3 p-5 md:flex-row">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="elysianview1…" spellCheck={false} className="ex-search flex-1" />
          <button type="submit" disabled={!key.trim() || busy} className="btn btn-solid h-10 px-5 text-[13px] font-medium">
            {busy ? 'Decrypting' : 'Decrypt'}
          </button>
        </form>
        <p className="border-t border-[var(--line)] px-5 py-3 text-[12.5px] text-[var(--ink-3)]">Decryption runs in this browser. The key is not sent to any server and cannot spend funds.</p>
        {error ? <p className="px-5 pb-4 text-[13px] text-[var(--danger)]">{error}</p> : null}
      </Card>

      {notes ? (
        <>
          <Card title="Shielded Balances">
            {balances.size ? (
              <div className="flex flex-wrap gap-3 p-5">
                {[...balances].map(([address, v]) => {
                  const t = sym(address);
                  return (
                    <div key={address} className="flex items-center gap-2.5 rounded-md border border-[var(--line)] px-3.5 py-2.5">
                      {t ? <TokenIcon symbol={t.symbol} size={22} /> : null}
                      <span className="mono tabular text-[14px]">{formatAmount(v, t?.decimals ?? 18, 6)}</span>
                      <span className="text-[13px] font-medium text-[var(--ink-2)]">{t?.symbol ?? short(address)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty>No unspent notes</Empty>
            )}
          </Card>

          <Card title={`Notes (${notes.length})`}>
            {notes.length ? (
              <div>
                <table className="ex-table">
                  <thead>
                    <tr><th>Leaf</th><th>Token</th><th>Amount</th><th>Status</th><th>Memo</th><th>Block</th><th>Txn Hash</th></tr>
                  </thead>
                  <tbody>
                    {notes.map((n) => {
                      const t = sym(assetToAddress(n.asset));
                      return (
                        <tr key={n.leafIndex}>
                          <td className="mono tabular">{n.leafIndex}</td>
                          <td>{t ? <span className="inline-flex items-center gap-1.5 font-medium"><TokenIcon symbol={t.symbol} size={16} /> {t.symbol}</span> : <span className="mono">{short(assetToAddress(n.asset))}</span>}</td>
                          <td className="mono tabular">{formatAmount(n.amount, t?.decimals ?? 18, 6)}</td>
                          <td><Dot tone={n.spent ? 'idle' : 'ok'}>{n.spent ? 'Spent' : 'Unspent'}</Dot></td>
                          <td className="text-[var(--ink-2)]">{n.memo || '–'}</td>
                          <td className="mono tabular">{n.block.toLocaleString('en-US')}</td>
                          <td>{n.tx ? <TxHash hash={n.tx} /> : '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>This key owns no notes</Empty>
            )}
          </Card>

          {orders.length ? (
            <Card title={`Sealed Orders (${orders.length})`}>
              <div>
                <table className="ex-table">
                  <thead>
                    <tr><th>Order</th><th>Batch</th><th>Selling</th><th>Buying</th><th>Txn Hash</th></tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.index}>
                        <td className="mono tabular">{o.index}</td>
                        <td className="mono tabular">{o.batchId}</td>
                        <td className="mono tabular">{formatAmount(o.amountIn, sym(o.assetIn)?.decimals ?? 18, 6)} {sym(o.assetIn)?.symbol ?? short(o.assetIn)}</td>
                        <td>{sym(o.assetOut)?.symbol ?? short(o.assetOut)}</td>
                        <td>{o.tx ? <TxHash hash={o.tx} /> : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

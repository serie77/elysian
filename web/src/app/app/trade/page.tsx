'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import type { OwnedSwap } from '@elysian/core';
import { Gate } from '@/components/app/Gate';
import { AmountField, AssetSelect, Notice, PageHead, Progress, Row, TxLink, friendlyError } from '@/components/app/Pieces';
import { dexAbi, poolAbi, swapAbi } from '@/lib/abi';
import { findAsset, formatAmount, parseAmount } from '@/lib/assets';
import { useAssets } from '@/lib/wallet/useAssets';
import { nodeApi } from '@/lib/node';
import { planClaim, planSwap } from '@/lib/wallet/actions';
import type { ProveProgress } from '@/lib/wallet/prover';
import { STALE_WALLET, useShielded } from '@/lib/wallet/store';
import { useChainClock } from '@/lib/wallet/clock';

export default function TradePage() {
  return (
    <Gate>
      <Suspense>
        <Trade />
      </Suspense>
    </Gate>
  );
}

const RELAY_DOWN = 'The relayer is offline, so this cannot be sent privately right now. Try again shortly.';

/** Opt out of the relayer. The wallet address then signs the transaction in public, so it is never the default. */
function DirectToggle({ direct, onChange }: { direct: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 text-[13px] text-[var(--ink-2)]">
      <input type="checkbox" checked={direct} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--bone)]" />
      <span>
        Send from my own wallet instead of the relayer.{' '}
        <span className="text-[var(--ink-3)]">Your wallet address becomes the public sender of this transaction and pays its gas.</span>
      </span>
    </label>
  );
}

function Trade() {
  const w = useShielded();
  const params = useSearchParams();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { assets, addByAddress } = useAssets();
  const held = w.balances.map((b) => findAsset(assets, b.asset)).filter(Boolean) as typeof assets;
  const dep = w.deployment!;

  const [assetIn, setAssetIn] = useState(params.get('in') ?? '');
  const [assetOut, setAssetOut] = useState('');
  const [amount, setAmount] = useState('');
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState<'proving' | 'submitting' | null>(null);
  const [progress, setProgress] = useState<ProveProgress | null>(null);
  const [ms, setMs] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [sealedBatch, setSealedBatch] = useState<number | null>(null);

  const inA = findAsset(assets, assetIn);
  const outA = findAsset(assets, assetOut);
  const balance = w.balances.find((b) => inA && b.asset === BigInt(inA.address))?.amount ?? 0n;
  const relayer = w.sync.state?.relayer ?? null;
  const useRelay = !direct;
  const relayReady = !useRelay || Boolean(relayer);
  const feeBps = useRelay ? BigInt(w.sync.state?.relayFeeBps ?? 0) : 0n;

  const parsed = useMemo(() => {
    try {
      return amount ? parseAmount(amount, inA?.decimals ?? 18) : 0n;
    } catch {
      return null;
    }
  }, [amount, inA]);
  const fee = parsed ? (parsed * feeBps) / 10_000n : 0n;

  const duration = dep.batchDuration;
  const now = useChainClock();
  const currentBatch = Math.floor(now / duration);
  const closesAt = (currentBatch + 1) * duration;
  const secondsLeft = closesAt - now;
  // The contract accepts the current batch or the next one; near the boundary, aim at the next.
  const targetBatch = secondsLeft > 20 ? currentBatch : currentBatch + 1;

  const { data: quote } = useReadContract({
    address: dep.dex,
    abi: dexAbi,
    functionName: 'quote',
    args: [inA?.address as `0x${string}`, outA?.address as `0x${string}`, parsed ?? 0n],
    query: { enabled: Boolean(inA && outA && parsed && parsed > 0n), retry: false },
  });

  const canSubmit = Boolean(inA && outA && inA.address !== outA.address && parsed && parsed > 0n && parsed + fee <= balance && relayReady && !busy);

  async function submit() {
    if (!inA || !outA || !parsed || !client) return;
    const session = w.live();
    setError(null);
    setHash(null);
    setMs(undefined);
    setBusy('proving');
    try {
      const notes = w.balances.find((b) => b.asset === BigInt(inA.address))?.notes ?? [];
      const ctx = { key: w.key!, domain: w.domain!, tree: w.poolTree, verifyRoot: w.verifyPoolRoot };
      const { bundle } = await planSwap(ctx, inA.address, outA.address, notes, parsed, BigInt(targetBatch), dep.swap, useRelay ? (relayer as `0x${string}`) : undefined, fee, setProgress);
      setMs(bundle.ms);
      setBusy('submitting');
      if (w.live() !== session) throw new Error(STALE_WALLET);
      const h = useRelay
        ? (await nodeApi.relay({ args: bundle.args, extData: bundle.extData })).hash
        : await writeContractAsync({ address: dep.pool, abi: poolAbi, functionName: 'transact', args: [bundle.args, bundle.extData] });
      const receipt = await client.waitForTransactionReceipt({ hash: h });
      w.markSpent(bundle.args.inputNullifiers);
      setSealedBatch(targetBatch);
      setHash(h);
      setAmount('');
      await w.refresh(Number(receipt.blockNumber));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  return (
    <>
      <PageHead n="03" title="Trade" sub="Swap one shielded asset for another in a sealed batch. Everyone in the batch clears at the same price; the chain does not see who was in it." />
      <div className="grid gap-px bg-[var(--line)] md:grid-cols-12">
        <form
          className="space-y-6 bg-[var(--bg)] p-6 md:col-span-7 md:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-6 md:grid-cols-2">
            <AssetSelect assets={held} value={assetIn} onChange={setAssetIn} label="From · shielded" />
            <AssetSelect assets={assets} value={assetOut} onChange={setAssetOut} label="To" exclude={assetIn} onAdd={addByAddress} />
          </div>
          <AmountField
            value={amount}
            onChange={setAmount}
            symbol={inA?.symbol}
            max={inA ? formatAmount(balance, inA.decimals) : undefined}
            // The fee is a share of the amount, so the most that fits is balance / (1 + rate).
            onMax={() => inA && setAmount(formatAmount((balance * 10_000n) / (10_000n + feeBps), inA.decimals, 18).replace(/,/g, ''))}
          />
          <DirectToggle direct={direct} onChange={setDirect} />
          <Progress p={progress} ms={ms} />
          {useRelay && !relayer && w.sync.state ? <Notice kind="error">{RELAY_DOWN}</Notice> : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          {hash ? (
            <Notice kind="ok">
              Intent sealed into batch {sealedBatch ?? targetBatch}. <TxLink hash={hash} chainId={w.chainId} />
            </Notice>
          ) : null}
          <button type="submit" className="btn btn-solid" disabled={!canSubmit}>
            {busy === 'proving' ? 'Proving' : busy === 'submitting' ? (useRelay ? 'Relaying' : 'Confirm in wallet') : `Seal into batch ${targetBatch}`}
          </button>
        </form>
        <aside className="bg-[var(--bg)] p-6 md:col-span-5 md:p-8">
          <div className="label mb-3">Batch</div>
          <Row k="Current" v={currentBatch} />
          <Row k="Closes in" v={<span className="tabular">{Math.max(0, secondsLeft)}s</span>} />
          <Row k="Your intent goes to" v={targetBatch} />
          <Row k="Batch length" v={`${duration}s`} />
          <Row k="Submitted by" v={useRelay ? 'relayer' : 'your wallet'} />
          <Row k="Relay fee" v={inA ? `${formatAmount(fee, inA.decimals)} ${inA.symbol}` : '–'} />
          <div className="label mb-3 mt-8">Indicative fill</div>
          <Row k="Venue quote" v={quote !== undefined && outA ? `${formatAmount(quote, outA.decimals)} ${outA.symbol}` : '–'} />
          <Row k="Clearing" v="uniform price per batch" />
          <p className="mt-8 text-[12px] leading-[1.6] text-[var(--ink-3)]">
            The chain sees the pair, the size and the batch number, not who placed the order or which claim follows it. That cover comes
            from company: an order alone in its batch is matched to its claim by size, so trade sizes and times that others trade too.
          </p>
        </aside>
      </div>

      <Intents direct={direct} />
      <RecentBatches />
    </>
  );
}

function Intents({ direct }: { direct: boolean }) {
  const w = useShielded();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { assets } = useAssets();
  const dep = w.deployment!;
  const [claiming, setClaiming] = useState<bigint | null>(null);
  const [progress, setProgress] = useState<ProveProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const useRelay = !direct;

  const rows = useMemo(() => [...w.swaps].sort((a, b) => b.leafIndex - a.leafIndex), [w.swaps]);
  const now = useChainClock();
  const currentBatch = BigInt(Math.floor(now / dep.batchDuration));

  function batchOf(s: OwnedSwap) {
    const addr = (id: bigint) => `0x${id.toString(16).padStart(40, '0')}`;
    return w.sync.batches.find((b) => b.batchId === s.batchId.toString() && b.assetIn === addr(s.assetIn) && b.assetOut === addr(s.assetOut));
  }

  async function claim(s: OwnedSwap) {
    if (!client) return;
    const session = w.live();
    setError(null);
    setHash(null);
    setClaiming(s.commitment);
    try {
      if (useRelay && !w.sync.state?.relayer) throw new Error(RELAY_DOWN);
      // Batch totals come from the node's batch feed, the same rows every wallet downloads, not a read that names this order's pair and batch.
      const batch = batchOf(s);
      if (!batch?.executed) throw new Error('This batch has not cleared yet.');
      const ctx = { key: w.key!, domain: { chainId: w.chainId, contract: dep.swap }, tree: w.swapTree, verifyRoot: w.verifySwapRoot };
      const { args } = await planClaim(ctx, s, BigInt(batch.totalIn), BigInt(batch.totalOut), batch.refunded, setProgress);
      if (w.live() !== session) throw new Error(STALE_WALLET);
      const h = useRelay ? (await nodeApi.claim(args)).hash : await writeContractAsync({ address: dep.swap, abi: swapAbi, functionName: 'claim', args: [args] });
      const receipt = await client.waitForTransactionReceipt({ hash: h });
      w.markClaimed(s.nullifier);
      setHash(h);
      await w.refresh(Number(receipt.blockNumber));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setClaiming(null);
      setProgress(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className="mt-12">
      <div className="label mb-4">Your intents</div>
      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {rows.map((s) => {
          const inA = findAsset(assets, s.assetIn);
          const outA = findAsset(assets, s.assetOut);
          const b = batchOf(s);
          const claimed = w.sync.claims.has(s.nullifier);
          const state = claimed ? 'claimed' : b?.executed ? 'ready' : s.batchId >= currentBatch ? 'open' : 'clearing';
          const out = b?.executed && b.totalIn !== '0' ? (s.amountIn * BigInt(b.totalOut)) / BigInt(b.totalIn) : null;
          return (
            <div key={s.commitment.toString()} className="grid items-center gap-3 py-4 text-[13px] md:grid-cols-[100px_1fr_1fr_120px_140px]">
              <span className="label">batch {s.batchId.toString()}</span>
              <span className="tabular">
                {formatAmount(s.amountIn, inA?.decimals ?? 18)} {inA?.symbol ?? '?'}
              </span>
              <span className="tabular text-[var(--ink-2)]">
                {out !== null ? `→ ${formatAmount(out, outA?.decimals ?? 18)} ${outA?.symbol ?? ''}` : `→ ${outA?.symbol ?? '?'}`}
              </span>
              <span className={`label ${state === 'ready' ? 'text-[var(--bone)]' : ''}`}>{state}</span>
              <span className="md:text-right">
                {state === 'ready' ? (
                  <button type="button" className="btn h-8 px-3 text-[11px]" disabled={claiming !== null} onClick={() => void claim(s)}>
                    {claiming === s.commitment ? 'Proving' : 'Claim'}
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 space-y-3">
        <Progress p={progress} />
        {error ? <Notice kind="error">{error}</Notice> : null}
        {hash ? (
          <Notice kind="ok">
            Claimed into the pool. <TxLink hash={hash} chainId={w.chainId} />
          </Notice>
        ) : null}
      </div>
    </section>
  );
}

function RecentBatches() {
  const w = useShielded();
  const { assets } = useAssets();
  const rows = w.sync.batches.slice(0, 12);
  if (rows.length === 0) return null;
  return (
    <section className="mt-12">
      <div className="label mb-4">Recent batches · public</div>
      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {rows.map((b) => {
          const inA = findAsset(assets, b.assetIn);
          const outA = findAsset(assets, b.assetOut);
          return (
            <div key={`${b.assetIn}${b.assetOut}${b.batchId}`} className="grid items-center gap-3 py-3 text-[13px] md:grid-cols-[100px_1fr_1fr_120px]">
              <span className="label">{b.batchId}</span>
              <span className="tabular">
                {formatAmount(BigInt(b.totalIn), inA?.decimals ?? 18)} {inA?.symbol ?? '?'}
              </span>
              <span className="tabular text-[var(--ink-2)]">{b.executed ? `→ ${formatAmount(BigInt(b.totalOut), outA?.decimals ?? 18)} ${outA?.symbol ?? ''}` : `→ ${outA?.symbol ?? '?'}`}</span>
              <span className="label">{b.refunded ? 'refunded' : b.executed ? 'cleared' : 'open'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

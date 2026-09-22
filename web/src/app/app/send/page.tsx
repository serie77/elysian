'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePublicClient, useWriteContract } from 'wagmi';
import { isAddress as isEvmAddress } from 'viem';
import { isAddress as isElysianAddress } from '@elysian/core';
import { Gate } from '@/components/app/Gate';
import { AmountField, AssetSelect, Notice, PageHead, Progress, Row, TxLink, friendlyError } from '@/components/app/Pieces';
import { poolAbi } from '@/lib/abi';
import { findAsset, formatAmount, parseAmount } from '@/lib/assets';
import { useAssets } from '@/lib/wallet/useAssets';
import { nodeApi } from '@/lib/node';
import { planTransfer, planUnshield } from '@/lib/wallet/actions';
import type { ProveProgress } from '@/lib/wallet/prover';
import { STALE_WALLET, useShielded } from '@/lib/wallet/store';

export default function SendPage() {
  return (
    <Gate>
      <Suspense>
        <Send />
      </Suspense>
    </Gate>
  );
}

type Mode = 'transfer' | 'unshield';

function Send() {
  const w = useShielded();
  const params = useSearchParams();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { assets, addByAddress } = useAssets();
  const held = w.balances.map((b) => findAsset(assets, b.asset)).filter(Boolean) as typeof assets;

  const [mode, setMode] = useState<Mode>('transfer');
  const [asset, setAsset] = useState(params.get('asset') ?? '');
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [memo, setMemo] = useState('');
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState<'proving' | 'submitting' | null>(null);
  const [progress, setProgress] = useState<ProveProgress | null>(null);
  const [ms, setMs] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);

  const selected = findAsset(assets, asset);
  const balance = w.balances.find((b) => selected && b.asset === BigInt(selected.address))?.amount ?? 0n;
  const relayer = w.sync.state?.relayer ?? null;
  // The relayer is the default. Sending from the connected wallet is a deliberate choice, never a fallback.
  const useRelay = !direct;
  const feeBps = useRelay && mode === 'unshield' ? BigInt(w.sync.state?.relayFeeBps ?? 0) : 0n;
  // The relay's flat minimum for this asset. It is the same for every transfer of the asset, so it says nothing about the amount.
  const [flat, setFlat] = useState<bigint | null>(null);
  const [feeError, setFeeError] = useState(false);
  const assetAddress = selected?.address;
  useEffect(() => {
    setFlat(null);
    setFeeError(false);
    if (!useRelay || !assetAddress) return;
    let live = true;
    nodeApi
      .relayFee(assetAddress)
      .then((f) => live && setFlat(BigInt(f.flat)))
      .catch(() => live && setFeeError(true));
    return () => {
      live = false;
    };
  }, [useRelay, assetAddress]);
  const relayReady = !useRelay || (Boolean(relayer) && flat !== null);

  const parsed = useMemo(() => {
    try {
      return amount ? parseAmount(amount, selected?.decimals ?? 18) : 0n;
    } catch {
      return null;
    }
  }, [amount, selected]);
  const share = parsed ? (parsed * feeBps) / 10_000n : 0n;
  const fee = useRelay ? (share > (flat ?? 0n) ? share : (flat ?? 0n)) : 0n;

  const validTo = mode === 'transfer' ? isElysianAddress(to) : isEvmAddress(to);
  const canSubmit = Boolean(selected && parsed && parsed > 0n && parsed + fee <= balance && validTo && relayReady && !busy);

  async function run() {
    if (!selected || !parsed || !client) return;
    const session = w.live();
    setError(null);
    setHash(null);
    setMs(undefined);
    setBusy('proving');
    try {
      const notes = w.balances.find((b) => b.asset === BigInt(selected.address))?.notes ?? [];
      const relayerAddr = useRelay ? (relayer as `0x${string}`) : undefined;
      const ctx = { key: w.key!, domain: w.domain!, tree: w.poolTree, verifyRoot: w.verifyPoolRoot };
      const bundle =
        mode === 'transfer'
          ? await planTransfer(ctx, selected.address, notes, parsed, to, memo || undefined, relayerAddr, fee, setProgress)
          : await planUnshield(ctx, selected.address, notes, parsed, to as `0x${string}`, relayerAddr, fee, setProgress);
      setMs(bundle.ms);
      setBusy('submitting');
      // The account or chain may have changed during proving: never submit an old identity's transaction, least of all from a new signer.
      if (w.live() !== session) throw new Error(STALE_WALLET);
      const h = useRelay
        ? (await nodeApi.relay({ args: bundle.args, extData: bundle.extData })).hash
        : await writeContractAsync({ address: w.deployment!.pool, abi: poolAbi, functionName: 'transact', args: [bundle.args, bundle.extData] });
      const receipt = await client.waitForTransactionReceipt({ hash: h });
      w.markSpent(bundle.args.inputNullifiers);
      setHash(h);
      setAmount('');
      setTo('');
      setMemo('');
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
      <PageHead n="02" title="Send" sub="Move shielded value to another elysian1 address, or unshield it back to a wallet on Robinhood Chain." />
      <div className="mb-px flex gap-px bg-[var(--line)]">
        {(['transfer', 'unshield'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setTo('');
            }}
            className={`flex-1 py-3 text-[13px] transition-colors ${mode === m ? 'bg-[var(--surface)] text-[var(--ink)]' : 'bg-[var(--bg)] text-[var(--ink-3)] hover:text-[var(--ink)]'}`}
          >
            {m === 'transfer' ? 'Private transfer' : 'Unshield'}
          </button>
        ))}
      </div>
      <div className="grid gap-px bg-[var(--line)] md:grid-cols-12">
        <form
          className="space-y-6 bg-[var(--bg)] p-6 md:col-span-7 md:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <AssetSelect assets={held} value={asset} onChange={setAsset} label="Shielded asset" />
          <AmountField
            value={amount}
            onChange={setAmount}
            symbol={selected?.symbol}
            max={selected ? formatAmount(balance, selected.decimals) : undefined}
            onMax={() => {
              if (!selected) return;
              // The most that fits: amount + max(share, flat minimum) <= balance.
              const byShare = (balance * 10_000n) / (10_000n + feeBps);
              const byFlat = balance - (flat ?? 0n);
              const most = byShare < byFlat ? byShare : byFlat;
              setAmount(formatAmount(most > 0n ? most : 0n, selected.decimals, 18).replace(/,/g, ''));
            }}
          />
          <label className="field">
            <span className="text-[13px] text-[var(--ink-3)]">{mode === 'transfer' ? 'Recipient elysian1 address' : 'Recipient 0x address'}</span>
            <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={mode === 'transfer' ? 'elysian1…' : '0x…'} spellCheck={false} autoComplete="off" className="mono text-[12px]" />
          </label>
          {mode === 'transfer' ? (
            <label className="field">
              <span className="text-[13px] text-[var(--ink-3)]">Memo · encrypted, optional</span>
              <input value={memo} onChange={(e) => setMemo(e.target.value.slice(0, 120))} placeholder="Only the recipient can read this" />
            </label>
          ) : null}
          <label className="flex items-start gap-3 text-[13px] text-[var(--ink-2)]">
            <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--bone)]" />
            <span>
              Send from my own wallet instead of the relayer.{' '}
              <span className="text-[var(--ink-3)]">Your wallet address becomes the public sender of this transaction and pays its gas.</span>
            </span>
          </label>
          <Progress p={progress} ms={ms} />
          {useRelay && !relayer && w.sync.state ? <Notice kind="error">The relayer is offline, so this cannot be sent privately right now. Try again shortly.</Notice> : null}
          {useRelay && relayer && feeError ? <Notice kind="error">The relay fee could not be loaded, so this cannot be sent privately right now. Try again shortly.</Notice> : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          {hash ? (
            <Notice kind="ok">
              Sent. <TxLink hash={hash} chainId={w.chainId} />
            </Notice>
          ) : null}
          <button type="submit" className="btn btn-solid" disabled={!canSubmit}>
            {busy === 'proving' ? 'Proving' : busy === 'submitting' ? (useRelay ? 'Relaying' : 'Confirm in wallet') : mode === 'transfer' ? 'Send privately' : 'Unshield'}
          </button>
        </form>
        <aside className="bg-[var(--bg)] p-6 md:col-span-5 md:p-8">
          <div className="label mb-3">The chain will see</div>
          <Row k="Asset" v={selected?.symbol ?? '–'} />
          <Row k="Amount out" v={mode === 'unshield' && parsed && selected ? formatAmount(parsed, selected.decimals) : '0'} />
          <Row k="Nullifiers" v="2" />
          <Row k="Commitments" v="2" />
          <Row k="Submitted by" v={useRelay ? 'relayer' : 'your wallet'} />
          <Row k="Relay fee" v={selected ? `${formatAmount(fee, selected.decimals)} ${selected.symbol}` : '–'} />
          <div className="label mb-3 mt-8">Only you will see</div>
          <Row k="Recipient" v={mode === 'transfer' ? 'inside the ciphertext' : 'public on exit'} />
          <Row k="Amounts" v={mode === 'transfer' ? 'hidden' : 'the exit amount'} />
          <Row k="Change note" v="back to you" />
          {mode === 'unshield' ? (
            <p className="mt-8 text-[12px] leading-[1.6] text-[var(--ink-3)]">
              Stock tokens check a blocklist on every transfer. If the recipient is blocked, the exit reverts and nothing is spent.
            </p>
          ) : null}
        </aside>
      </div>
    </>
  );
}

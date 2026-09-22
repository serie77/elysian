'use client';

import { useMemo, useState } from 'react';
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { parseAbi } from 'viem';
import { Gate } from '@/components/app/Gate';
import { AmountField, AssetSelect, Notice, PageHead, Progress, Row, TxLink, friendlyError } from '@/components/app/Pieces';
import { erc20Abi, poolAbi } from '@/lib/abi';
import { findAsset, formatAmount, parseAmount } from '@/lib/assets';
import { planShield } from '@/lib/wallet/actions';
import type { ProveProgress } from '@/lib/wallet/prover';
import { STALE_WALLET, useShielded } from '@/lib/wallet/store';
import { useAssets } from '@/lib/wallet/useAssets';
import { TokenIcon } from '@/components/ui/TokenIcon';

const wethAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256 wad)']);

export default function ShieldPage() {
  return (
    <Gate>
      <Shield />
    </Gate>
  );
}

type Step = 'idle' | 'wrapping' | 'approving' | 'proving' | 'submitting' | 'done';

function Shield() {
  const w = useShielded();
  const { address: eoa } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { assets, addByAddress } = useAssets();
  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [wrapAmount, setWrapAmount] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [progress, setProgress] = useState<ProveProgress | null>(null);
  const [ms, setMs] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const selected = findAsset(assets, asset);
  const pool = w.deployment!.pool;
  const isWeth = selected?.kind === 'eth';

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: asset as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [eoa!],
    query: { enabled: Boolean(asset && eoa) },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: asset as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [eoa!, pool],
    query: { enabled: Boolean(asset && eoa) },
  });
  const { data: eth, refetch: refetchEth } = useBalance({ address: eoa, query: { enabled: Boolean(eoa && isWeth) } });

  const parsed = useMemo(() => {
    try {
      return amount ? parseAmount(amount, selected?.decimals ?? 18) : 0n;
    } catch {
      return null;
    }
  }, [amount, selected]);

  const needsApproval = parsed !== null && parsed > 0n && (allowance ?? 0n) < parsed;
  const canSubmit = Boolean(selected && parsed && parsed > 0n && (balance ?? 0n) >= parsed && step === 'idle');

  async function wrap() {
    if (!selected || !client) return;
    setError(null);
    try {
      const v = parseAmount(wrapAmount, 18);
      setStep('wrapping');
      const h = await writeContractAsync({ address: selected.address, abi: wethAbi, functionName: 'deposit', value: v });
      await client.waitForTransactionReceipt({ hash: h });
      setWrapAmount('');
      await Promise.all([refetchBalance(), refetchEth()]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setStep('idle');
    }
  }

  async function run() {
    if (!selected || !parsed || !client) return;
    const session = w.live();
    setError(null);
    setHash(null);
    setMs(undefined);
    try {
      if (needsApproval) {
        setStep('approving');
        const h = await writeContractAsync({ address: selected.address, abi: erc20Abi, functionName: 'approve', args: [pool, parsed] });
        await client.waitForTransactionReceipt({ hash: h });
        await refetchAllowance();
      }
      setStep('proving');
      const bundle = await planShield({ key: w.key!, domain: w.domain!, tree: w.poolTree }, selected.address, parsed, setProgress);
      setMs(bundle.ms);
      setStep('submitting');
      if (w.live() !== session) throw new Error(STALE_WALLET);
      const h = await writeContractAsync({ address: pool, abi: poolAbi, functionName: 'transact', args: [bundle.args, bundle.extData] });
      const receipt = await client.waitForTransactionReceipt({ hash: h });
      setHash(h);
      setStep('done');
      setAmount('');
      await Promise.all([refetchBalance(), w.refresh(Number(receipt.blockNumber))]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setStep('idle');
      setProgress(null);
    }
  }

  return (
    <>
      <PageHead n="01" title="Shield" sub="Deposit any ERC-20 on this chain into the pool. It becomes a note only your keys can find, and only your keys can spend." />
      <div className="grid gap-px bg-[var(--line)] md:grid-cols-12">
        <form
          className="space-y-6 bg-[var(--bg)] p-6 md:col-span-7 md:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <AssetSelect assets={assets} value={asset} onChange={setAsset} onAdd={addByAddress} />
          {isWeth ? (
            <div className="panel space-y-3 p-4">
              <div className="flex items-baseline justify-between">
                <span className="label">Wrap ETH first</span>
                <span className="label tabular">{eth ? `${formatAmount(eth.value, 18)} ETH in wallet` : ''}</span>
              </div>
              <div className="flex gap-2">
                <input value={wrapAmount} onChange={(e) => setWrapAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className="h-11 flex-1 border border-[var(--line)] bg-[var(--surface)] px-3 tabular" />
                <button type="button" className="btn h-11 px-4 text-[12px]" disabled={!wrapAmount || step !== 'idle'} onClick={() => void wrap()}>
                  {step === 'wrapping' ? 'Wrapping' : 'Wrap'}
                </button>
              </div>
              <p className="text-[12px] leading-[1.6] text-[var(--ink-3)]">The pool holds ERC-20s only. Wrapping is a plain WETH deposit and can be undone any time.</p>
            </div>
          ) : null}
          <AmountField
            value={amount}
            onChange={setAmount}
            symbol={selected?.symbol}
            max={balance !== undefined && selected ? formatAmount(balance, selected.decimals) : undefined}
            onMax={() => balance !== undefined && selected && setAmount(formatAmount(balance, selected.decimals, 18).replace(/,/g, ''))}
          />
          <Progress p={progress} ms={ms} />
          {error ? <Notice kind="error">{error}</Notice> : null}
          {hash ? (
            <Notice kind="ok">
              Shielded. <TxLink hash={hash} chainId={w.chainId} />
            </Notice>
          ) : null}
          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-solid" disabled={!canSubmit}>
              {step === 'approving' ? 'Approving' : step === 'proving' ? 'Proving' : step === 'submitting' ? 'Confirm in wallet' : needsApproval ? 'Approve and shield' : 'Shield'}
            </button>
            {parsed !== null && balance !== undefined && parsed > balance ? <span className="text-[13px] text-[var(--danger)]">Exceeds wallet balance.</span> : null}
          </div>
        </form>
        <aside className="bg-[var(--bg)] p-6 md:col-span-5 md:p-8">
          <div className="label mb-3">The chain will see</div>
          <Row
            k="Asset"
            v={
              selected ? (
                <span className="inline-flex items-center gap-2">
                  <TokenIcon symbol={selected.symbol} size={20} />
                  {selected.symbol}
                </span>
              ) : (
                '–'
              )
            }
          />
          <Row k="Amount in" v={parsed && selected ? formatAmount(parsed, selected.decimals) : '–'} />
          <Row k="From" v={<span className="mono text-[11px]">your wallet</span>} />
          <div className="label mb-3 mt-8">Only you will see</div>
          <Row k="Note owner" v="pk" />
          <Row k="Blinding" v="fresh randomness" />
          <Row k="Future spends" v="unlinkable" />
          <p className="mt-8 text-[12px] leading-[1.6] text-[var(--ink-3)]">
            Shielding is the one step that links your wallet to an amount. Everything after it is a proof. For stronger anonymity, shield
            round amounts and wait before spending. Tokens with transfer fees or rebasing balances are not supported.
          </p>
        </aside>
      </div>
    </>
  );
}

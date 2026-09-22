'use client';

import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { chainName, robinhood } from '@/lib/chains';
import { deploymentFor } from '@/lib/deployments';
import { short } from '@/lib/assets';

export function Connect() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const deployment = deploymentFor(chainId);

  if (!isConnected) {
    const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
    return (
      <div className="flex items-center gap-3">
        {error ? <span className="text-[12px] text-[var(--danger)]">{connectError(error)}</span> : null}
        <button type="button" className="btn btn-solid h-9 px-4 text-[12px]" disabled={!injected || isPending} onClick={() => injected && connect({ connector: injected })}>
          {isPending ? 'Connecting' : 'Connect wallet'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {!deployment ? (
        <button type="button" className="btn h-9 px-3 text-[12px] text-[var(--bone)]" disabled={switching} onClick={() => switchChain({ chainId: robinhood.id })}>
          {switching ? 'Switching' : `Switch network · on ${chainName(chainId!)}`}
        </button>
      ) : (
        <span className="label hidden md:inline">{chainName(chainId!)}</span>
      )}
      <button type="button" className="btn h-9 px-3 text-[12px]" onClick={() => disconnect()} title="Disconnect">
        <span className="mono">{short(address!)}</span>
      </button>
    </div>
  );
}

function connectError(e: Error): string {
  const m = e.message ?? '';
  if (/rejected|denied/i.test(m)) return 'Connection declined in wallet.';
  if (/not found|no provider|Provider/i.test(m)) return 'No wallet found in this browser.';
  return 'Could not connect.';
}

'use client';

import { useAccount } from 'wagmi';
import { PROTOCOL_VERSION } from '@elysian/core';
import { deploymentVersion } from '@/lib/deployments';
import { useShielded } from '@/lib/wallet/store';
import { Connect } from './Connect';

/** Renders children only once a wallet is connected on a supported chain and keys are derived. */
export function Gate({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();
  const w = useShielded();

  if (!isConnected) {
    return (
      <Empty title="Connect a wallet" body="Elysian runs on Robinhood Chain. Connect an injected wallet to continue.">
        <Connect />
      </Empty>
    );
  }
  if (!w.deployment) {
    const v = deploymentVersion(w.chainId);
    return v && v !== PROTOCOL_VERSION ? (
      <Empty
        title="Older deployment"
        body={`Elysian on this network is protocol version ${v}; this app speaks version ${PROTOCOL_VERSION}. Notes in the older pool are withdrawn with the recovery tool described in docs/RECOVERY.md, then shielded again here.`}
      >
        <Connect />
      </Empty>
    ) : (
      <Empty title="Unsupported network" body="Switch your wallet to Robinhood Chain, its testnet, or a local deployment.">
        <Connect />
      </Empty>
    );
  }
  if (!w.key) {
    return (
      <Empty
        title="Derive your shielded keys"
        body="Sign one message. The signature becomes your spending key, viewing key and elysian1 address, so whoever holds it holds your shielded balance: only sign it here. It never leaves this device and is forgotten when the tab closes or the account changes."
      >
        <button type="button" className="btn btn-solid" disabled={w.deriving} onClick={() => void w.derive()}>
          {w.deriving ? 'Waiting for signature' : 'Sign to derive keys'}
        </button>
        {w.error ? <p className="text-[13px] text-[var(--danger)]">{w.error}</p> : null}
      </Empty>
    );
  }
  return <>{children}</>;
}

function Empty({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="panel corner mx-auto mt-10 max-w-[520px] p-8 md:p-10">
      <h2 className="h2 text-[28px]">{title}</h2>
      <p className="mt-4 text-[14px] leading-[1.6] text-[var(--ink-2)]">{body}</p>
      <div className="mt-8 flex flex-col items-start gap-3">{children}</div>
    </div>
  );
}

import { PROTOCOL_VERSION } from '@elysian/core';
import registry from './deployments.json';

export interface Deployment {
  network: string;
  chainId: number;
  startBlock: number;
  pool: `0x${string}`;
  swap: `0x${string}`;
  dex: `0x${string}`;
  batchDuration: number;
  levels: number;
  tokens?: Record<string, `0x${string}`>;
  version?: number;
  owner?: `0x${string}`;
  executor?: `0x${string}`;
}

const ZERO = '0x0000000000000000000000000000000000000000';

export function deploymentFor(chainId: number | undefined): Deployment | undefined {
  if (!chainId) return undefined;
  const d = (registry as Record<string, Deployment>)[String(chainId)];
  // A deployment of another protocol version is refused outright: its hashes and proving keys differ.
  if (!d || d.pool === ZERO || d.version !== PROTOCOL_VERSION) return undefined;
  return d;
}

/** The protocol version recorded for a chain's deployment (1 when the record predates versioning). */
export function deploymentVersion(chainId: number | undefined): number | undefined {
  const d = chainId ? (registry as Record<string, Deployment>)[String(chainId)] : undefined;
  return d && d.pool !== ZERO ? (d.version ?? 1) : undefined;
}

export const NODE_URL = process.env.NEXT_PUBLIC_NODE_URL ?? 'http://127.0.0.1:8787';

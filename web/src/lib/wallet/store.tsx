'use client';

/**
 * Shielded wallet state. The spending key lives in this tab's memory and nowhere else: it is
 * re-derived from a wallet signature and dropped when the account or chain changes. Notes are
 * rebuilt by scanning the node's ciphertext log, page by page, and both trees are mirrored locally
 * so proofs never ask a server for a path.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useSignMessage } from 'wagmi';
import {
  KEY_DERIVATION_MESSAGE,
  MerkleTree,
  SpendingKey,
  TREE_LEVELS,
  balances as computeBalances,
  encodeAddress,
  hexToBytes,
  scanCommitments,
  scanSwaps,
  toHex32,
  type Balance,
  type Domain,
  type OwnedNote,
  type OwnedSwap,
} from '@elysian/core';
import { poolAbi, swapAbi } from '../abi';
import { nodeApi, type BatchRow, type CommitmentRow, type NodeState, type SwapRow } from '../node';
import { deploymentFor, type Deployment } from '../deployments';

export interface WalletSync {
  commitments: CommitmentRow[];
  swaps: SwapRow[];
  nullifiers: Set<bigint>;
  claims: Set<bigint>;
  batches: BatchRow[];
  state: NodeState | null;
  lastSyncedAt: number;
}

export interface ShieldedWallet {
  key: SpendingKey | null;
  address: string | null;
  deriving: boolean;
  derive: () => Promise<void>;
  forget: () => void;
  deployment: Deployment | undefined;
  chainId: number;
  /** The (chain, pool) pair every proof is bound to. */
  domain: Domain | null;
  sync: WalletSync;
  syncing: boolean;
  nodeOnline: boolean;
  /** Re-sync from the node; with minBlock, wait until the node has indexed that block first. */
  refresh: (minBlock?: number) => Promise<void>;
  /** Optimistically mark notes as spent so the next action cannot reselect them. */
  markSpent: (nullifiers: (bigint | `0x${string}`)[]) => void;
  markClaimed: (nullifier: bigint | `0x${string}`) => void;
  notes: OwnedNote[];
  swaps: OwnedSwap[];
  balances: Balance[];
  poolTree: MerkleTree;
  swapTree: MerkleTree;
  /** Whether the contract accepts a root the local mirror produced: a generic read that names no leaf. */
  verifyPoolRoot: (root: bigint) => Promise<boolean>;
  verifySwapRoot: (root: bigint) => Promise<boolean>;
  /** Identity counter: capture it before a long operation and compare it right before submitting. */
  live: () => number;
  error: string | null;
}

export const STALE_WALLET = 'The wallet changed while this was being prepared. Nothing was sent.';

const Ctx = createContext<ShieldedWallet | null>(null);

const emptySync = (): WalletSync => ({ commitments: [], swaps: [], nullifiers: new Set(), claims: new Set(), batches: [], state: null, lastSyncedAt: 0 });

export function ShieldedWalletProvider({ children }: { children: React.ReactNode }) {
  const { address: eoa, isConnected } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient();
  const { signMessageAsync } = useSignMessage();
  const deployment = deploymentFor(chainId);
  const domain = useMemo<Domain | null>(() => (deployment ? { chainId, contract: deployment.pool } : null), [chainId, deployment]);

  const [key, setKey] = useState<SpendingKey | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [nodeOnline, setNodeOnline] = useState(false);
  const [sync, setSync] = useState<WalletSync>(emptySync);

  const poolTree = useRef(new MerkleTree(TREE_LEVELS));
  const swapTree = useRef(new MerkleTree(TREE_LEVELS));
  // Bumped whenever the account or chain changes, so nothing still in flight for the old identity lands in the new one.
  const generation = useRef(0);

  // A new account or chain is a new identity: forget the key and start the scan over.
  useEffect(() => {
    generation.current++;
    setKey(null);
    setError(null);
    poolTree.current = new MerkleTree(TREE_LEVELS);
    swapTree.current = new MerkleTree(TREE_LEVELS);
    pendingSpent.current = new Set();
    pendingClaims.current = new Set();
    setSync(emptySync());
  }, [eoa, chainId]);

  useEffect(() => {
    if (!isConnected) setKey(null);
  }, [isConnected]);

  const derive = useCallback(async () => {
    if (!eoa) return;
    const g = generation.current;
    setDeriving(true);
    setError(null);
    try {
      const signature = await signMessageAsync({ message: KEY_DERIVATION_MESSAGE(chainId) });
      // The account or chain changed while the wallet was open: this signature belongs to the old identity.
      if (g !== generation.current) return;
      setKey(SpendingKey.fromSignature(signature));
    } catch (e) {
      if (g === generation.current) setError((e as Error).message.includes('rejected') ? 'Signature declined.' : 'Could not derive keys.');
    } finally {
      setDeriving(false);
    }
  }, [eoa, chainId, signMessageAsync]);

  const forget = useCallback(() => setKey(null), []);

  // Spends and claims this tab has submitted but the node has not reported yet. Every sync result is merged with
  // these, so a refresh that started before the transaction can never resurrect a note that is already spent.
  const pendingSpent = useRef(new Set<bigint>());
  const pendingClaims = useRef(new Set<bigint>());

  const markSpent = useCallback((nullifiers: (bigint | `0x${string}`)[]) => {
    for (const n of nullifiers) pendingSpent.current.add(BigInt(n));
    setSync((prev) => ({ ...prev, nullifiers: new Set([...prev.nullifiers, ...nullifiers.map((n) => BigInt(n))]) }));
  }, []);

  const markClaimed = useCallback((nullifier: bigint | `0x${string}`) => {
    pendingClaims.current.add(BigInt(nullifier));
    setSync((prev) => ({ ...prev, claims: new Set([...prev.claims, BigInt(nullifier)]) }));
  }, []);

  const refresh = useCallback(async (minBlock?: number) => {
    const g = generation.current;
    setSyncing(true);
    try {
      let state = await nodeApi.state();
      setNodeOnline(true);
      // The node polls the chain every couple of seconds; give it a moment to catch up to our receipt.
      for (let i = 0; minBlock !== undefined && state.lastBlock < minBlock && i < 30; i++) {
        await new Promise((r) => setTimeout(r, 700));
        state = await nodeApi.state();
      }
      // Generic, ordered pages of everything the node has, whichever leaves turn out to be ours.
      const [c, s, n, b, cl] = await Promise.all([
        nodeApi.allCommitments(poolTree.current.size),
        nodeApi.allSwaps(swapTree.current.size),
        nodeApi.nullifiers(),
        nodeApi.allBatches(),
        nodeApi.claims(),
      ]);
      if (g !== generation.current) return;
      for (const row of c) if (row.index === poolTree.current.size) poolTree.current.insert(BigInt(row.commitment));
      for (const row of s) if (row.index === swapTree.current.size) swapTree.current.insert(BigInt(row.commitment));
      const nullifiers = new Set(n.rows.map((x) => BigInt(x)));
      const claims = new Set(cl.rows.map((x) => BigInt(x)));
      for (const x of pendingSpent.current) if (nullifiers.has(x)) pendingSpent.current.delete(x);
      for (const x of pendingClaims.current) if (claims.has(x)) pendingClaims.current.delete(x);
      setSync((prev) => ({
        commitments: [...prev.commitments, ...c.filter((r) => r.index >= prev.commitments.length)],
        swaps: [...prev.swaps, ...s.filter((r) => r.index >= prev.swaps.length)],
        nullifiers: new Set([...nullifiers, ...pendingSpent.current]),
        claims: new Set([...claims, ...pendingClaims.current]),
        batches: b,
        state,
        lastSyncedAt: Date.now(),
      }));
    } catch {
      setNodeOnline(false);
    } finally {
      if (g === generation.current) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 6_000);
    return () => clearInterval(t);
  }, [refresh]);

  const verifyPoolRoot = useCallback(
    async (root: bigint) => Boolean(client && deployment && (await client.readContract({ address: deployment.pool, abi: poolAbi, functionName: 'isKnownRoot', args: [toHex32(root)] }))),
    [client, deployment],
  );
  const verifySwapRoot = useCallback(
    async (root: bigint) => Boolean(client && deployment && (await client.readContract({ address: deployment.swap, abi: swapAbi, functionName: 'isKnownRoot', args: [toHex32(root)] }))),
    [client, deployment],
  );

  const notes = useMemo(() => {
    if (!key) return [];
    const records = sync.commitments.map((r) => ({ commitment: BigInt(r.commitment), index: r.index, ciphertext: hexToBytes(r.ciphertext) }));
    return scanCommitments(key, records);
  }, [key, sync.commitments]);

  const swaps = useMemo(() => {
    if (!key) return [];
    const records = sync.swaps.map((r) => ({
      commitment: BigInt(r.commitment),
      index: r.index,
      batchId: BigInt(r.batchId),
      assetIn: BigInt(r.assetIn),
      assetOut: BigInt(r.assetOut),
      amountIn: BigInt(r.amountIn),
      ciphertext: hexToBytes(r.ciphertext),
    }));
    return scanSwaps(key, records);
  }, [key, sync.swaps]);

  const balances = useMemo(() => computeBalances(notes, sync.nullifiers), [notes, sync.nullifiers]);

  const value: ShieldedWallet = {
    key,
    address: key ? encodeAddress(key.address()) : null,
    deriving,
    derive,
    forget,
    deployment,
    chainId,
    domain,
    sync,
    syncing,
    nodeOnline,
    refresh,
    markSpent,
    markClaimed,
    notes,
    swaps,
    balances,
    poolTree: poolTree.current,
    swapTree: swapTree.current,
    verifyPoolRoot,
    verifySwapRoot,
    live: () => generation.current,
    error,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShielded(): ShieldedWallet {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShielded outside provider');
  return v;
}

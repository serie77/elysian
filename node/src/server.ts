import Fastify from 'fastify';
import cors from '@fastify/cors';
import { decodeAbiParameters, parseAbiParameters, type Hex } from 'viem';
import { FIELD_SIZE } from '@elysian/core';
import { dexAbi, erc20Abi, poolAbi, swapAbi } from './abi.js';
import { publicClient, relayer } from './chain.js';
import { config } from './config.js';
import { q, type BatchRow, type CommitmentRow, type SwapRow } from './db.js';
import { poolTree, status, swapTree } from './indexer.js';
import { registerExplorer } from './explorer.js';

const hex32 = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}`;

export async function startServer() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  registerExplorer(app);

  app.get('/health', async () => ({ ok: true, chainId: config.chainId, ...status(), poolRoot: hex32(poolTree.root), swapRoot: hex32(swapTree.root) }));

  app.get('/state', async () => {
    const s = status();
    const counts = q.counts.get() as Record<string, number>;
    // Read against the pending block: on chains that only mine on demand, 'latest' can be minutes old.
    const pending = await publicClient.getBlock({ blockTag: 'pending' }).catch(() => publicClient.getBlock());
    const current = BigInt(pending.timestamp) / BigInt(config.batchDuration);
    return {
      chainTime: Number(pending.timestamp),
      chainId: config.chainId,
      pool: config.pool,
      swap: config.swap,
      dex: config.dex,
      batchDuration: config.batchDuration,
      currentBatch: current.toString(),
      lastBlock: s.lastBlock,
      poolRoot: hex32(poolTree.root),
      swapRoot: hex32(swapTree.root),
      poolLeaves: s.poolLeaves,
      swapLeaves: s.swapLeaves,
      relayer: relayer?.account.address ?? null,
      relayFeeBps: config.relayFeeBps,
      relayMinFeeUsd: config.relayMinFeeUsd,
      tokens: config.tokens,
      counts,
    };
  });

  app.get<{ Querystring: { from?: string; limit?: string } }>('/commitments', async (req) => {
    const from = Number(req.query.from ?? 0);
    const limit = Math.min(Number(req.query.limit ?? 2000), 5000);
    const rows = q.commitmentsFrom.all(from, limit) as unknown as CommitmentRow[];
    return { from, rows: rows.map((r) => ({ index: r.idx, commitment: r.commitment, ciphertext: r.ciphertext, block: r.block, tx: r.tx })) };
  });

  app.get('/nullifiers', async () => {
    const rows = q.allNullifiers.all() as { nullifier: string }[];
    return { rows: rows.map((r) => r.nullifier) };
  });

  app.get('/claims', async () => {
    const rows = q.allClaims.all() as { nullifier: string }[];
    return { rows: rows.map((r) => r.nullifier) };
  });

  app.get<{ Querystring: { from?: string; limit?: string } }>('/swaps', async (req) => {
    const from = Number(req.query.from ?? 0);
    const limit = Math.min(Number(req.query.limit ?? 2000), 5000);
    const rows = q.swapsFrom.all(from, limit) as unknown as SwapRow[];
    return {
      from,
      rows: rows.map((r) => ({
        index: r.idx,
        commitment: r.commitment,
        batchId: r.batch_id,
        assetIn: r.asset_in,
        assetOut: r.asset_out,
        amountIn: r.amount_in,
        ciphertext: r.ciphertext,
        block: r.block,
        tx: r.tx,
      })),
    };
  });

  app.get<{ Querystring: { assetIn?: string; assetOut?: string; limit?: string; offset?: string } }>('/batches', async (req) => {
    const rows = (req.query.assetIn && req.query.assetOut
      ? q.batchesFor.all(req.query.assetIn.toLowerCase(), req.query.assetOut.toLowerCase())
      : q.batchesPage.all(Math.min(Number(req.query.limit ?? 50), 5000), Number(req.query.offset ?? 0))) as unknown as BatchRow[];
    return {
      rows: rows.map((r) => ({ assetIn: r.asset_in, assetOut: r.asset_out, batchId: r.batch_id, totalIn: r.total_in, totalOut: r.total_out, executed: r.executed === 1, refunded: r.refunded === 1 })),
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/activity', async (req) => ({ rows: q.recentActivity.all(Math.min(Number(req.query.limit ?? 50), 200)) }));

  app.get<{ Params: { index: string } }>('/path/:index', async (req, reply) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index >= poolTree.size) return reply.code(404).send({ error: 'unknown leaf' });
    const p = poolTree.path(index);
    return { index, root: hex32(p.root), pathElements: p.pathElements.map(hex32) };
  });

  app.get<{ Params: { index: string } }>('/swap-path/:index', async (req, reply) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index >= swapTree.size) return reply.code(404).send({ error: 'unknown leaf' });
    const p = swapTree.path(index);
    return { index, root: hex32(p.root), pathElements: p.pathElements.map(hex32) };
  });

  /* --------------------------------- relaying --------------------------------- */

  interface RelayBody {
    args: {
      proof: Hex;
      root: Hex;
      inputNullifiers: [Hex, Hex];
      outputCommitments: [Hex, Hex];
      publicAmount: string;
      assetId: string;
      extDataHash: Hex;
    };
    extData: {
      recipient: Hex;
      extAmount: string;
      relayer: Hex;
      fee: string;
      encryptedOutput1: Hex;
      encryptedOutput2: Hex;
      adapterData: Hex;
    };
  }

  // Every relayed transaction pays at least a flat minimum (RELAY_MIN_FEE_USD in the asset being moved), and anything
  // leaving the pool pays a share on top. The flat part is the same for every transfer of an asset, so a transfer's
  // fee says nothing about its size. Priced by the venue's quote and cached for a minute; an asset the venue cannot
  // price pays the share alone.
  const flatFees = new Map<string, { at: number; fee: bigint }>();
  let usdgDecimals: number | undefined;
  async function flatFee(asset: Hex): Promise<bigint> {
    const key = asset.toLowerCase();
    const hit = flatFees.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.fee;
    let fee = 0n;
    if (config.usdg && config.relayMinFeeUsd > 0) {
      usdgDecimals ??= Number(await publicClient.readContract({ address: config.usdg, abi: erc20Abi, functionName: 'decimals' }));
      const usd = BigInt(Math.round(config.relayMinFeeUsd * 10 ** usdgDecimals));
      if (key === config.usdg.toLowerCase()) fee = usd;
      else {
        try {
          fee = await publicClient.readContract({ address: config.dex, abi: dexAbi, functionName: 'quote', args: [config.usdg, asset, usd] });
        } catch {
          fee = 0n;
        }
      }
    }
    flatFees.set(key, { at: Date.now(), fee });
    return fee;
  }

  app.get<{ Params: { asset: string } }>('/relay/fee/:asset', async (req) => ({ bps: config.relayFeeBps, flat: (await flatFee(req.params.asset as Hex)).toString() }));

  app.post<{ Body: RelayBody }>('/relay', async (req, reply) => {
    if (!relayer) return reply.code(503).send({ error: 'relaying is not enabled on this node' });
    const { args, extData } = req.body;
    const extAmount = BigInt(extData.extAmount);
    const fee = BigInt(extData.fee);
    if (extData.relayer.toLowerCase() !== relayer.account.address.toLowerCase()) {
      return reply.code(400).send({ error: 'extData.relayer must be this node' });
    }
    if (extAmount > 0n) return reply.code(400).send({ error: 'shielding must be sent by the depositor' });
    const moved = extAmount < 0n ? -extAmount : 0n;
    const share = (moved * BigInt(config.relayFeeBps)) / 10_000n;
    const flat = await flatFee(`0x${BigInt(args.assetId).toString(16).padStart(40, '0')}`);
    const minFee = share > flat ? share : flat;
    if (fee < minFee) return reply.code(400).send({ error: 'fee below the relay minimum', minFee: minFee.toString() });

    const proofArgs = {
      proof: args.proof,
      root: args.root,
      inputNullifiers: args.inputNullifiers,
      outputCommitments: args.outputCommitments,
      publicAmount: BigInt(args.publicAmount),
      assetId: BigInt(args.assetId),
      extDataHash: args.extDataHash,
    };
    const ext = { ...extData, extAmount, fee };
    try {
      const { request } = await publicClient.simulateContract({
        address: config.pool,
        abi: poolAbi,
        functionName: 'transact',
        args: [proofArgs, ext],
        account: relayer.account,
      });
      const hash = await relayer.writeContract(request);
      return { hash };
    } catch (e) {
      return reply.code(400).send({ error: describeRevert(e) });
    }
  });

  interface ClaimBody {
    proof: Hex;
    swapRoot: Hex;
    batchId: string;
    assetIn: Hex;
    assetOut: Hex;
    nullifier: Hex;
    outputCommitment: Hex;
    encryptedOutput: Hex;
  }

  app.post<{ Body: ClaimBody }>('/claim', async (req, reply) => {
    if (!relayer) return reply.code(503).send({ error: 'relaying is not enabled on this node' });
    const b = req.body;
    try {
      const { request } = await publicClient.simulateContract({
        address: config.swap,
        abi: swapAbi,
        functionName: 'claim',
        args: [{ ...b, batchId: BigInt(b.batchId) }],
        account: relayer.account,
      });
      const hash = await relayer.writeContract(request);
      return { hash };
    } catch (e) {
      return reply.code(400).send({ error: describeRevert(e) });
    }
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[server] listening on :${config.port} (chain ${config.chainId}, pool ${config.pool})`);
}

function describeRevert(e: unknown): string {
  const msg = (e as Error).message ?? 'transaction failed';
  const m = msg.match(/Error: (\w+)\(/) ?? msg.match(/reverted with reason string '([^']+)'/);
  return m ? `rejected: ${m[1]}` : 'transaction could not be submitted';
}

void FIELD_SIZE;
void decodeAbiParameters;
void parseAbiParameters;

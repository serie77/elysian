/**
 * Clears closed swap batches. Quotes the venue, applies the slippage bound, and calls executeBatch.
 */
import { dexAbi, swapAbi } from './abi.js';
import { executor, publicClient } from './chain.js';
import { config } from './config.js';
import { q, type BatchRow } from './db.js';

async function minOutFor(assetIn: `0x${string}`, assetOut: `0x${string}`, amountIn: bigint): Promise<bigint> {
  try {
    const quote = await publicClient.readContract({ address: config.dex, abi: dexAbi, functionName: 'quote', args: [assetIn, assetOut, amountIn] });
    return (quote * BigInt(10_000 - config.slippageBps)) / 10_000n;
  } catch {
    return 0n;
  }
}

export async function executePending(): Promise<void> {
  if (!executor) return;
  const pendingBlock = await publicClient.getBlock({ blockTag: 'pending' }).catch(() => publicClient.getBlock());
  const current = BigInt(pendingBlock.timestamp) / BigInt(config.batchDuration);
  const pending = q.pendingBatches.all(Number(current)) as unknown as BatchRow[];
  for (const b of pending) {
    const assetIn = b.asset_in as `0x${string}`;
    const assetOut = b.asset_out as `0x${string}`;
    const batchId = BigInt(b.batch_id);
    const onchain = await publicClient.readContract({ address: config.swap, abi: swapAbi, functionName: 'getBatch', args: [assetIn, assetOut, batchId] });
    if (onchain.executed || onchain.totalIn === 0n) continue;
    const minOut = await minOutFor(assetIn, assetOut, onchain.totalIn);
    try {
      // No quote means no route or no liquidity: hand the orders back rather than trade blind or leave them waiting.
      const hash = await executor.writeContract(
        minOut > 0n
          ? { address: config.swap, abi: swapAbi, functionName: 'executeBatch', args: [assetIn, assetOut, batchId, minOut] }
          : { address: config.swap, abi: swapAbi, functionName: 'cancelBatch', args: [assetIn, assetOut, batchId] },
      );
      console.log(`[executor] batch ${batchId} ${assetIn} -> ${assetOut} totalIn ${onchain.totalIn} ${minOut > 0n ? 'executed' : 'refunded'} tx ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
    } catch (e) {
      console.error('[executor]', (e as Error).message.split('\n')[0]);
    }
  }
}

export function startExecutor() {
  if (!executor) {
    console.log('[executor] no EXECUTOR_KEY, batches must be cleared elsewhere');
    return;
  }
  const loop = async () => {
    try {
      await executePending();
    } catch (e) {
      console.error('[executor]', (e as Error).message);
    }
    setTimeout(loop, Math.max(5_000, (config.batchDuration * 1000) / 4));
  };
  void loop();
}

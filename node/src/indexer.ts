/**
 * Follows ElysianPool and ElysianSwap, keeps the sqlite log and an in-memory mirror of both trees.
 * Wallets read commitments and ciphertexts from here instead of scanning the chain themselves.
 */
import { MerkleTree, TREE_LEVELS } from '@elysian/core';
import { poolAbi, swapAbi } from './abi.js';
import { publicClient } from './chain.js';
import { config } from './config.js';
import { db, meta, q } from './db.js';

export const poolTree = new MerkleTree(TREE_LEVELS);
export const swapTree = new MerkleTree(TREE_LEVELS);

let lastBlock = Number(meta.get('lastBlock') ?? config.startBlock - 1);
let syncing = false;

export function status() {
  return { lastBlock, poolLeaves: poolTree.size, swapLeaves: swapTree.size, poolRoot: poolTree.root, swapRoot: swapTree.root };
}

function hydrate() {
  const commitments = q.allCommitments.all() as { commitment: string }[];
  poolTree.bulkInsert(commitments.map((r) => BigInt(r.commitment)));
  const swaps = q.allSwaps.all() as { commitment: string }[];
  swapTree.bulkInsert(swaps.map((r) => BigInt(r.commitment)));
  console.log(`[indexer] hydrated ${poolTree.size} commitments, ${swapTree.size} swap intents, last block ${lastBlock}`);
}

async function syncRange(from: bigint, to: bigint) {
  const [poolLogs, swapLogs, blockInfo] = await Promise.all([
    publicClient.getContractEvents({ address: config.pool, abi: poolAbi, fromBlock: from, toBlock: to }),
    publicClient.getContractEvents({ address: config.swap, abi: swapAbi, fromBlock: from, toBlock: to }),
    publicClient.getBlock({ blockNumber: to }),
  ]);
  const logs = [...poolLogs, ...swapLogs].sort((a, b) =>
    a.blockNumber === b.blockNumber ? Number(a.logIndex) - Number(b.logIndex) : Number(a.blockNumber - b.blockNumber),
  );

  db.exec('BEGIN');
  try {
    for (const log of logs) {
      const block = Number(log.blockNumber);
      const tx = log.transactionHash;
      const ts = Number(blockInfo.timestamp);
      switch (log.eventName) {
        case 'NewCommitment': {
          const { commitment, index, encryptedOutput } = log.args as { commitment: `0x${string}`; index: bigint; encryptedOutput: `0x${string}` };
          const idx = Number(index);
          if (idx === poolTree.size) poolTree.insert(BigInt(commitment));
          q.insertCommitment.run(idx, commitment, encryptedOutput, block, tx);
          break;
        }
        case 'NewNullifier': {
          const { nullifier } = log.args as { nullifier: `0x${string}` };
          q.insertNullifier.run(nullifier, block, tx);
          break;
        }
        case 'Shielded': {
          const { asset, amount } = log.args as { asset: `0x${string}`; amount: bigint };
          q.insertActivity.run('shield', asset.toLowerCase(), amount.toString(), block, tx, ts);
          break;
        }
        case 'Unshielded': {
          const { asset, amount, recipient } = log.args as { asset: `0x${string}`; recipient: `0x${string}`; amount: bigint };
          const kind = recipient.toLowerCase() === config.swap.toLowerCase() ? 'swap' : 'unshield';
          q.insertActivity.run(kind, asset.toLowerCase(), amount.toString(), block, tx, ts);
          break;
        }
        case 'SwapIntent': {
          const a = log.args as {
            commitment: `0x${string}`;
            index: bigint;
            batchId: bigint;
            assetIn: `0x${string}`;
            assetOut: `0x${string}`;
            amountIn: bigint;
            ciphertext: `0x${string}`;
          };
          const idx = Number(a.index);
          if (idx === swapTree.size) swapTree.insert(BigInt(a.commitment));
          q.insertSwap.run(idx, a.commitment, a.batchId.toString(), a.assetIn.toLowerCase(), a.assetOut.toLowerCase(), a.amountIn.toString(), a.ciphertext, block, tx);
          const batch = await publicClient.readContract({
            address: config.swap,
            abi: swapAbi,
            functionName: 'getBatch',
            args: [a.assetIn, a.assetOut, a.batchId],
          });
          q.upsertBatchIn.run(a.assetIn.toLowerCase(), a.assetOut.toLowerCase(), a.batchId.toString(), batch.totalIn.toString());
          break;
        }
        case 'BatchExecuted': {
          const a = log.args as { batchId: bigint; assetIn: `0x${string}`; assetOut: `0x${string}`; totalIn: bigint; totalOut: bigint };
          q.upsertBatchIn.run(a.assetIn.toLowerCase(), a.assetOut.toLowerCase(), a.batchId.toString(), a.totalIn.toString());
          q.executeBatch.run(a.totalIn.toString(), a.totalOut.toString(), a.assetIn.toLowerCase(), a.assetOut.toLowerCase(), a.batchId.toString());
          q.insertActivity.run('batch', `${a.assetIn.toLowerCase()}:${a.assetOut.toLowerCase()}`, a.totalIn.toString(), block, tx, ts);
          break;
        }
        case 'BatchCancelled': {
          const a = log.args as { batchId: bigint; assetIn: `0x${string}`; assetOut: `0x${string}`; totalIn: bigint };
          q.upsertBatchIn.run(a.assetIn.toLowerCase(), a.assetOut.toLowerCase(), a.batchId.toString(), a.totalIn.toString());
          q.refundBatch.run(a.assetIn.toLowerCase(), a.assetOut.toLowerCase(), a.batchId.toString());
          q.insertActivity.run('batch', `${a.assetIn.toLowerCase()}:${a.assetOut.toLowerCase()}`, a.totalIn.toString(), block, tx, ts);
          break;
        }
        case 'SwapClaimed': {
          const a = log.args as { nullifier: `0x${string}`; outputCommitment: `0x${string}` };
          q.insertClaim.run(a.nullifier, a.outputCommitment, block);
          break;
        }
      }
    }
    lastBlock = Number(to);
    meta.set('lastBlock', String(lastBlock));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function syncOnce(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const head = Number(await publicClient.getBlockNumber());
    while (lastBlock < head) {
      const from = lastBlock + 1;
      const to = Math.min(head, from + config.logRange - 1);
      await syncRange(BigInt(from), BigInt(to));
    }
  } finally {
    syncing = false;
  }
}

export function startIndexer() {
  hydrate();
  const loop = async () => {
    try {
      await syncOnce();
    } catch (e) {
      console.error('[indexer]', (e as Error).message);
    }
    setTimeout(loop, config.pollMs);
  };
  void loop();
}

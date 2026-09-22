import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// One .env at the repo root serves the contracts, the node and the web app.
const rootEnv = path.resolve(here, '../../.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

interface Deployment {
  chainId: number;
  startBlock: number;
  pool: `0x${string}`;
  swap: `0x${string}`;
  dex: `0x${string}`;
  batchDuration: number;
  tokens?: Record<string, `0x${string}`>;
}

function loadDeployment(): Deployment | undefined {
  const name = process.env.DEPLOYMENT ?? 'localhost';
  const file = path.resolve(here, '../../contracts/deployments', `${name}.json`);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Deployment;
}

const dep = loadDeployment();
const env = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`missing ${k}`);
  return v;
};

const chainId = Number(process.env.CHAIN_ID ?? dep?.chainId ?? 31337);
const alchemy: Record<number, string> = { 4663: 'robinhood-mainnet', 46630: 'robinhood-testnet' };
const defaultRpc = alchemy[chainId] && process.env.ALCHEMY_KEY ? `https://${alchemy[chainId]}.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}` : 'http://127.0.0.1:8545';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  rpcUrl: env('RPC_URL', defaultRpc),
  chainId,
  pool: (process.env.POOL_ADDRESS ?? dep?.pool) as `0x${string}`,
  swap: (process.env.SWAP_ADDRESS ?? dep?.swap) as `0x${string}`,
  dex: (process.env.DEX_ADDRESS ?? dep?.dex) as `0x${string}`,
  startBlock: Number(process.env.START_BLOCK ?? dep?.startBlock ?? 0),
  batchDuration: Number(process.env.BATCH_DURATION ?? dep?.batchDuration ?? 60),
  tokens: dep?.tokens ?? {},
  dataDir: process.env.DATA_DIR ?? path.resolve(here, '../data'),
  pollMs: Number(process.env.POLL_MS ?? 2000),
  logRange: Number(process.env.LOG_RANGE ?? 5000),
  relayerKey: process.env.RELAYER_KEY as `0x${string}` | undefined,
  executorKey: process.env.EXECUTOR_KEY as `0x${string}` | undefined,
  /** Minimum relay fee in basis points of the unshielded amount. */
  relayFeeBps: Number(process.env.RELAY_FEE_BPS ?? 10),
  slippageBps: Number(process.env.SLIPPAGE_BPS ?? 50),
};

if (!config.pool || !config.swap) {
  throw new Error('no deployment found: set POOL_ADDRESS and SWAP_ADDRESS or DEPLOYMENT=<network>');
}

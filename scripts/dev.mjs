/**
 * One-command local stack:
 *   1. hardhat node (chain 31337)
 *   2. deploy contracts with demo tokens and a mock venue
 *   3. elysian node (indexer + relayer + executor)
 *   4. web app
 *
 *   node scripts/dev.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Hardhat's first two default accounts: deployer/executor and relayer.
const DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const RELAYER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: root, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const tag = `[${name}]`.padEnd(10);
  child.stdout.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')));
  child.stderr.on('data', (d) => process.stderr.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')));
  child.on('exit', (code) => console.log(`${tag} exited ${code}`));
  return child;
}

async function waitForRpc(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      if (res.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`rpc at ${url} did not come up`);
}

if (!existsSync(resolve(root, 'circuits/build/transaction/transaction.zkey'))) {
  console.error('circuit artifacts missing: run `npm run circuits` first');
  process.exit(1);
}

const children = [];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

children.push(run('chain', npx, ['hardhat', 'node', '--hostname', '127.0.0.1'], { cwd: resolve(root, 'contracts') }));
await waitForRpc('http://127.0.0.1:8545');

await new Promise((res, rej) => {
  const d = run('deploy', npx, ['hardhat', 'run', 'scripts/deploy.ts', '--network', 'localhost'], {
    cwd: resolve(root, 'contracts'),
    env: { ...process.env, SEED_DEMO: '1', BATCH_DURATION: '60' },
  });
  d.on('exit', (code) => (code === 0 ? res() : rej(new Error('deploy failed'))));
});

children.push(
  run('node', npm, ['run', 'dev', '-w', '@elysian/node'], {
    env: { ...process.env, DEPLOYMENT: 'localhost', RPC_URL: 'http://127.0.0.1:8545', RELAYER_KEY: RELAYER, EXECUTOR_KEY: DEPLOYER, PORT: '8787' },
  }),
);
children.push(run('web', npm, ['run', 'dev', '-w', 'web'], { env: { ...process.env, NEXT_PUBLIC_NODE_URL: 'http://127.0.0.1:8787' } }));

console.log('\nelysian dev stack: chain :8545 · node :8787 · web :3000\n');

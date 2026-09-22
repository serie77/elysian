# Deployment

## 1. Circuits

```bash
curl -L -o circuits/ptau/pot16.ptau https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_16.ptau
npm run circuits
```

`npm run circuits` builds the proving keys from fresh OS randomness: two contributions and a beacon, all discarded when the process exits. The verifiers and the browser artifacts in `web/public/circuits` are regenerated in the same run, so always deploy contracts and site from the same build.

## 2. Contracts

```bash
cp .env.example .env         # at the repo root: ALCHEMY_KEY, DEPLOYER_KEY, EXECUTOR
cd contracts
npm run deploy:testnet       # or deploy:mainnet
```

The script deploys, in order: Poseidon hasher, both verifiers, `ElysianPool`, the venue adapter (`UniswapV3Adapter` wired to Uniswap's Robinhood Chain deployment on mainnet, `MockDex` everywhere else), `ElysianSwap`; then registers the adapter on the pool and the executor on the adapter. Output goes to `contracts/deployments/<network>.json` and `web/src/lib/deployments.json`.

Then record and check the release:

```bash
node scripts/release-manifest.mjs robinhood                                           # sha256 of circuits, keys, browser artifacts and contract sources → contracts/deployments/robinhood.manifest.json
cd contracts && DEPLOYMENT=robinhood npx hardhat run scripts/verify-deployment.ts --network robinhood   # on-chain bytecode == compiled artifacts, immutables masked
```

Verify on Blockscout with `npx hardhat verify --network robinhoodTestnet <address> <constructor args>`.

The venue: Uniswap v3 is live on Robinhood Chain (SwapRouter02, QuoterV2 and factory addresses are in `contracts/scripts/uniswap.ts`). The adapter has no owner and no configuration: it picks the fee tier and, when needed, a route through WETH per swap. Any contract implementing `IDexAdapter` can replace it through `ElysianSwap.setDex`, which is how v4 or another venue would be added.

## 3. Node

```bash
cd node                      # reads the same root .env
npm start
```

| Variable | Meaning |
| --- | --- |
| `DEPLOYMENT` | name of the file in `contracts/deployments` to read addresses from |
| `ALCHEMY_KEY` | Alchemy key for Robinhood Chain; the node, the contracts and the web app's server routes build their RPC from it. The browser never receives it: reads go through `/api/rpc/<chainId>` |
| `RPC_URL` | optional override of the RPC for the chosen deployment |
| `RELAYER_KEY` | optional; enables `/relay` and `/claim` |
| `EXECUTOR_KEY` | optional; enables batch execution (must be registered on `ElysianSwap`) |
| `RELAY_FEE_BPS` | minimum fee on relayed unshields, default 10 |
| `SLIPPAGE_BPS` | executor slippage bound when the venue exposes `quote`, default 50 |
| `LOG_RANGE` | blocks per `getLogs` call, default 5000 |

Deploy on Railway as a Node service with a persistent volume mounted at `DATA_DIR`. Put it behind Cloudflare with the relayer route rate-limited.

## 4. Web

```bash
cd web
NEXT_PUBLIC_NODE_URL=https://node.example npm run build
npm start
```

Serve `public/circuits` with long cache headers (configured in `next.config.ts`). The transaction proving key is 12 MB and downloads once per browser.

## 5. Checklist before mainnet

- Contracts and site built from the same `npm run circuits` run; `release-manifest.mjs` written and `verify-deployment.ts` passing against the live addresses.
- Every contract test passing (`npm test`), and the audit reproduction rejected (`npx hardhat test ../docs/audit/claim-ciphertext.test.ts --no-compile`).
- `ElysianPool` and `ElysianSwap` ownership transferred to a multisig (Safe 1.4.1 is deployed on Robinhood Chain).
- Pool address confirmed not blocklisted by the stock token registry.
- A recovery route for the previous version's notes (`docs/RECOVERY.md`).
- Executor funded; grace period reviewed.

## Site on Vercel, node elsewhere

The web app deploys to Vercel as is. The node (indexer, relayer, batch executor) is a long-running process with a database and private keys, so it cannot run on Vercel: host it on Railway, Fly or a VPS from `node/Dockerfile` with a persistent volume at `/data`, behind https.

Vercel project settings:

| Setting | Value |
| --- | --- |
| Root Directory | `web` (leave "Include files outside the Root Directory" on; the build needs `packages/core`) |
| Framework | Next.js. Install and build commands come from `web/vercel.json` |
| Node.js | 22.x (pinned in `web/package.json`) |
| `NEXT_PUBLIC_NODE_URL` | public https URL of the node |
| `ALCHEMY_KEY` | server side only; used by `/api/rpc/<chainId>` and `/api/transfers` |
| `NEXT_PUBLIC_TOKEN_CA` | token address for the copy box; empty until launch |

Things that must be in the repository for the deployment to work, and are:

- `web/public/circuits/v2/*.zkey` and `*.wasm`. These are the only keys that can prove against the deployed mainnet verifiers. They cannot be regenerated; `npm run circuits` refuses to run once `contracts/deployments/robinhood.json` exists. The path carries the protocol version so browsers never reuse a cached older key.
- `web/src/lib/deployments.json` with the mainnet addresses.
- A `package-lock.json` that lists the Linux builds of native packages. One written on Windows or macOS may not; `node scripts/fix-lockfile-platforms.mjs` adds what is missing without changing versions.

Node host variables: `DEPLOYMENT=robinhood`, `ALCHEMY_KEY` (or `RPC_URL`), `RELAYER_KEY`, `EXECUTOR_KEY`, `DATA_DIR=/data`. Use separate funded wallets for relayer and executor.

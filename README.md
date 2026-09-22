# Elysian

A shielded execution layer for [Robinhood Chain](https://docs.robinhood.com/chain). Shield any ERC-20 on the chain, tokenized stocks included, transfer it without a trace, and trade it in sealed batches. Proofs replace disclosures.

Elysian borrows its note model and key hierarchy from Zcash Orchard, its EVM shielded-pool shape and adapter pattern from Railgun, its sealed batch swaps from Penumbra's ZSwap, and its client-side proving from Aztec. Everything runs against Robinhood Chain's ordinary ERC-20s: no wrapped assets, no bridge. See [docs/COMPARISON.md](docs/COMPARISON.md).

```
packages/core   protocol primitives: keys, notes, commitments, nullifiers, encryption, trees, witnesses
circuits        circom: transaction (2-in 2-out join-split) and swapClaim, Groth16 over BN254
contracts       ElysianPool (shielded pool), ElysianSwap (sealed batches), venue adapters, verifiers
node            indexer, relayer, batch executor, HTTP API (Fastify + node:sqlite)
web             landing site and shielded wallet (Next.js, anime.js, wagmi, snarkjs in a worker)
docs            protocol, architecture, deployment and comparison notes
```

## Quick start

Requires Node 22.12+ and [circom 2.2](https://docs.circom.io/getting-started/installation/).

```bash
npm install
npm run build:core          # compile @elysian/core
npm run circuits            # compile circuits, Groth16 setup, emit verifiers + browser artifacts
npm test                    # 13 contract tests with real proofs: every failure path, refunds, forged orders, admin delays
npm run dev                 # hardhat chain + deploy + demo tokens + elysian node + web
```

The circuit build needs `circuits/ptau/pot16.ptau` (Perpetual Powers of Tau, 2^16). Fetch it once:

```bash
curl -L -o circuits/ptau/pot16.ptau https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_16.ptau
```

`npm run dev` brings up a local chain with mock NVDA, TSLA, USDG and WETH minted to the first Hardhat account and a constant-product venue. Import that account (`0xac09…ff80`) into a browser wallet pointed at `http://127.0.0.1:8545` (chain id 31337) and open the app (Next picks the next free port if 3000 is taken; check the `[web]` line in the output).

Two checks run against the real chain, no local stack needed:

```bash
npx tsx node/scripts/verify-assets.ts              # audits all 196 listed tokens on Robinhood mainnet: code, symbol, decimals, supply
cd contracts && FORK=1 npx hardhat test test-fork/fork.test.ts   # forks mainnet and shields, sends and unshields REAL NVDA, TSLA, AAPL, SPY, USDG, WETH
```

Last run: 196/196 tokens answer as ERC-20s with matching symbols (USDG is 6 decimals, everything else 18), and all six fork flows pass with real proofs. Results land in `docs/asset-audit.json`.

Three more checks exercise the running stack without a wallet extension:

```bash
npx tsx node/scripts/smoke.ts                      # shield, relay, unshield, swap, execute, claim through the node API
node web/scripts/e2e.mjs http://localhost:3001     # the same flow driven through the web UI in headless Chrome
node web/scripts/snapshot.mjs http://localhost:3001/ out 1440 900 900 1800   # scroll-stop screenshots + console errors
```

## Which chain am I on?

| Chain id | What it is | When you see it |
| --- | --- | --- |
| 31337 | The local Hardhat chain that `npm run dev` starts | Development. Contracts, node and wallet all point here. Nothing on it is real. |
| 46630 | Robinhood Chain **testnet** | After `npm run deploy:testnet` with a funded deployer. Faucet: https://faucet.testnet.chain.robinhood.com (browser only). |
| 4663 | Robinhood Chain **mainnet** | After `npm run deploy:mainnet`. |

The contracts are chain-agnostic; the app and node read addresses from `contracts/deployments/<network>.json`. A deployment to Robinhood Chain is one command once a key holds ETH there:

```bash
cd contracts
DEPLOYER_KEY=0x… EXECUTOR=<node signer> npm run deploy:testnet
cd ../node && DEPLOYMENT=robinhoodTestnet RELAYER_KEY=0x… EXECUTOR_KEY=0x… npm start
cd ../web && NEXT_PUBLIC_NODE_URL=http://localhost:8787 npm run dev
```

## Mainnet

Live on Robinhood Chain (4663), protocol version 2. Addresses are in `contracts/deployments/robinhood.json`: pool `0xABde7D691dA4f00070D3C8CC2fC390B3181e1bd9`, swap `0xCAE13cCb69C1B37BD1D85E024d16c44fd0724835`, Uniswap adapter `0xcD5E0EEb02A8A23f2CFd3b4b087226A9ADD418f6`. The version 1 contracts (`contracts/deployments/archive/robinhood-v1.json`) stay on chain; their notes are withdrawn as described in [docs/RECOVERY.md](docs/RECOVERY.md).

```bash
cd node && DEPLOYMENT=robinhood PORT=8788 RELAYER_KEY=0x… EXECUTOR_KEY=0x… npm start      # node, relayer and batch executor
cd web && NEXT_PUBLIC_NODE_URL=http://127.0.0.1:8788 npm run build && npx next start     # site and explorer against mainnet
# the real site driven in a browser on mainnet, signing locally (phases: address, shield, send, trade, withdraw):
WALLET=A PHASE=shield TOKEN=USDG AMOUNT=1 node web/scripts/e2e-mainnet.mjs http://localhost:3002
# every feature with real funds, small amounts, everything withdrawn back to the wallet at the end:
DEPLOYMENT=robinhood NODE_URL=http://127.0.0.1:8788 RPC_URL=<rpc> WALLET_KEY=0x… UNIT=10000 ASSET_IN=<USDG> ASSET_OUT=<WETH> npx tsx node/scripts/smoke.ts
```

## Fund safety

- An order's size is folded into its leaf on-chain from the amount the pool actually sent, so a claim can never be for more than was put in.
- A batch that cannot clear (no route, no liquidity, no executor) is cancelled and every order is refunded one for one in the asset it sold. An executor can cancel at once; after an hour anyone can. Only executors can execute, because the caller sets the slippage floor.
- Unshielding needs only the owner's proof. No operator can block it.
- Adapters can mint notes, so once the pool holds deposits a new adapter needs a public two-day wait; swapping the trading venue has the same delay.
- Tokens that take a cut on transfer are refused at shield time, and a batch settles on what the pool really received.

## Explorer

`/explorer` is a block explorer for the protocol in the Etherscan mould: a home page with headline numbers, pool holdings, contract addresses and tree roots, latest transactions and latest batches; paginated `/explorer/txs`, `/explorer/batches` and `/explorer/notes` (commitments and nullifiers); `/explorer/tx/<hash>` with status, block and confirmations, method and selector, from and to, ERC-20 transfers, the decoded shielded action (token, public amount, recipient, relayer and fee, batch, roots, nullifiers, commitments), gas and fee, input data, decoded event logs, and a tab listing the fields that never reach the chain; and `/explorer/view`, which decrypts a viewing key's notes, balances and sealed orders in the browser. Search takes a transaction hash, a commitment or a nullifier. Anything the chain does not contain is shown as a redaction bar marked Shielded.

It reads the node's `/explorer/*` routes (`node/src/explorer.ts`), built from the indexer's tables plus each transaction's calldata and receipt, cached in a `tx_meta` table, so the web app needs `NEXT_PUBLIC_NODE_URL` pointing at a running node. `npx tsx node/scripts/smoke.ts` prints a viewing key to try.

## Token address and brand

The landing page has a contract address box with one-tap copy. It stays redacted until `NEXT_PUBLIC_TOKEN_CA` is set (root `.env` locally, a service variable on Railway; rebuild after changing it). The logo is a blackletter E run through by a spear, drawn from Texturina Bold (SIL Open Font License; the banner wordmark is Manufacturing Consent, same licence); the outlines live in `web/src/components/ui/Mark.tsx` and as `brand/logo-white.svg` and `brand/logo-mono.svg`. `brand/` also holds the X profile picture and banner; edit `brand/src/*.html` and run `node brand/render.mjs` to re-render them.

## RPC and keys

One `.env` at the repo root (copy `.env.example`) serves the contracts, the node and the web app. Set `ALCHEMY_KEY` and everything that talks to Robinhood Chain uses Alchemy; leave it empty and the public RPC is used. The key never reaches the browser: wallet reads go through `/api/rpc/<chainId>`, a relay with a method allowlist, and the landing page's transfers come from `/api/transfers`. On Railway, set `ALCHEMY_KEY` as a service variable.

## Any token

The landing page's "Today, the chain sees everything" table shows real transfers: the browser pulls the newest ones from the mainnet RPC on load, and `npx tsx web/scripts/snapshot-transfers.mts` refreshes the frozen set it renders first. Every row links to its transaction on robin.etherscan.io.

Token logos come from Simple Icons (CC0) through `node web/scripts/build-token-icons.mjs`; the ticker-to-brand map is explicit, and tickers with no open-licensed logo get a monogram tile.

`ElysianPool` identifies assets by address (`assetId = uint160(token)`) and has no registry. Anything that is an ERC-20 on the chain can be shielded, transferred and traded, including every Robinhood stock token, USDG, WETH, and whatever address you paste into the picker. Native ETH is shielded as WETH; the Shield page wraps it for you. Tokens that take a cut on transfer are refused at shield time (`UnsupportedToken`), because the pool could not pay everyone back; rebasing tokens are not supported either.

Trading works for any pair Uniswap v3 can reach, launchpad memecoins included, with nothing registered in Elysian. For every batch `UniswapV3Adapter` compares the deepest direct pool with the deepest route through WETH, asks the Uniswap quoter which pays more for that exact size, and trades there. So USDG to PONS works even though no such pool exists, and a token whose only pool is WETH at the 1% tier is reachable from a stock token. Proven against live liquidity:

```bash
cd contracts && FORK=1 npx hardhat test test-fork/trade.fork.test.ts   # privately buys Artificial Inu (long.xyz) and PONS, sells AI into NVDA
```

Not reachable yet: tokens whose only liquidity is on Uniswap v4, Ramses, or still on a launchpad bonding curve. Each needs its own `IDexAdapter`.

## What the chain sees

| Action | Public | Private |
| --- | --- | --- |
| Shield | asset, amount in, depositor | note owner, blinding |
| Transfer | asset, two nullifiers, two commitments, flat relay fee | sender, recipient, amounts, memo |
| Unshield | asset, amount out, recipient, relayer fee | which notes were spent |
| Swap intent | pair, size, batch | owner |
| Batch clear | totals, clearing ratio | who was in the batch |
| Claim | batch, output commitment | which intent is being claimed, when the batch held more than one order |

## Network parameters

| | Mainnet | Testnet |
| --- | --- | --- |
| Chain id | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robin.etherscan.io` | `https://explorer.testnet.chain.robinhood.com` |
| Gas | ETH | ETH |
| Stack | Arbitrum Orbit, blobs on Ethereum | same |

Notes shielded in the version 1 pool are withdrawn with `node/scripts/exit-v1.ts`; see [docs/RECOVERY.md](docs/RECOVERY.md).

`npm run circuits` generates the proving keys from fresh OS randomness (two contributions and a beacon) that is discarded when the process exits; keys are never derived from anything in the repository. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Elysian is independent software and is not affiliated with Robinhood Markets, Inc. Robinhood Stock Tokens carry jurisdictional restrictions and a per-address blocklist; the pool respects both on every exit and does not remove them.

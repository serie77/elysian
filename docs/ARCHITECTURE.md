# Architecture

```
┌──────────────────────┐      ┌──────────────────────┐      ┌────────────────────────────┐
│  Browser wallet      │      │  Elysian node         │      │  Robinhood Chain (4663)     │
│                      │      │                      │      │                            │
│  sign → sk           │      │  indexer (sqlite)    │◄─────│  ElysianPool                │
│  scan ciphertexts    │◄────►│  /commitments        │ logs │   Poseidon tree, nullifiers│
│  build notes         │      │  /swaps /batches     │      │   Groth16 verifier         │
│  mirror both trees   │      │  /nullifiers /claims │      │   ERC-20 custody           │
│  prove (web worker)  │      │                      │      │                            │
│  relay ──────────────┼─────►│  /relay /claim ──────┼─────►│  ElysianSwap (adapter)      │
│                      │      │  executor ───────────┼─────►│   swap tree, batches       │
└──────────────────────┘      └──────────────────────┘      │   Uniswap v3 adapter       │
                                                            └────────────┬───────────────┘
                                                                         │ Arbitrum Orbit
                                                                         ▼
                                                                    Ethereum L1
```

## packages/core

Pure TypeScript, no I/O. Everything the circuits assume about the data (hashes, encodings, serialization) lives here once and is shared by the tests, the node and the browser. Key modules:

- `keys.ts`: `SpendingKey`, viewing keys, bech32m addresses.
- `note.ts`, `swap.ts`: commitments, nullifiers, plaintext layouts.
- `encryption.ts`: x25519 + HKDF + XChaCha20-Poly1305.
- `merkle.ts`: incremental Poseidon tree mirroring the Solidity one.
- `extdata.ts`: ABI encoding of `ExtData` and adapter data, `publicAmount`, and the domain-bound `extDataHash` / `claimDataHash`.
- `prover.ts`: witness builders for both circuits, proof encoding for Solidity.
- `wallet.ts`: scanning, balances, note selection.

## circuits

`transaction.circom` and `swapClaim.circom`, sharing `keypair.circom` and `merkleProof.circom`. `scripts/build.mjs` compiles, runs the Groth16 setup over `ptau/pot16.ptau`, writes Solidity verifiers into `contracts/contracts/verifiers` and copies `.wasm`, `.zkey` and verification keys into `web/public/circuits`.

## contracts

- `MerkleTreeWithHistory.sol`: append-only Poseidon tree with a 100-root ring buffer. The Poseidon hasher is deployed from circomlibjs bytecode.
- `ElysianPool.sol`: the pool. Single entry point `transact`, adapter registry, `insertFromAdapter`.
- `ElysianSwap.sol`: adapter. Intents, batches, execution, claims.
- `adapters/UniswapV3Adapter.sol`: venue adapter for the original v3 `SwapRouter` interface. Swap `dex` on `ElysianSwap` to point at a different venue.
- `mocks/`: constant-product venue and a blocklisting ERC-20 for tests and local development.
- `test/elysian.test.ts`: full flows with real proofs: shield, transfer, relayed unshield with fee, double-spend rejection, blocklist rejection, intent → execute → claim → unshield.
- `test/edges.test.ts`: two-input spends with change, multiple assets per key, tampered proofs and stale roots, hash and amount mismatches, fee and amount bounds, adapter gating, root history expiry, viewing-key spend detection, shared clearing price across users, reverse-direction batches, batch rule violations, executor gate and grace period, claims before execution.

## node

- `indexer.ts`: polls `getLogs` for both contracts, writes sqlite, keeps in-memory trees, and records per-batch totals by reading `getBatch` at intent time.
- `executor.ts`: clears closed batches with a slippage bound from the venue quote when the venue exposes one.
- `server.ts`: ordered, generic read endpoints for wallets (no per-leaf path lookups on the ordinary paths) plus `/relay` and `/claim`, which simulate before sending and require the fee to meet `RELAY_FEE_BPS`.

The node holds only public data. Anyone can run one; a wallet mirrors both trees from the ordered log and checks its own root with `isKnownRoot()` before proving.

## web

- `/` landing, `/protocol` specification, `/app/*` wallet.
- `lib/wallet/store.tsx`: derives keys from a signature (memory only; dropped on account or chain change), pages through the node's log, mirrors both trees, scans ciphertexts, computes balances.
- `lib/wallet/actions.ts`: recipes (shield, transfer, unshield, swap, claim) that build witnesses from the local trees and call the prover. Sends, orders and claims are relayed by default.
- `public/prover.worker.js`: classic worker that loads `snarkjs.min.js` and the circuit artifacts and runs `groth16.fullProve` off the main thread.
- Motion: Lenis for inertial scroll; anime.js v4 `onScroll` observers with `sync` for scroll-linked figures, `splitText` for headline reveals, `createDrawable` for the line drawings.

## Threat model in one paragraph

The node is untrusted for privacy: it sees what the chain sees, and wallets never ask it for a specific leaf. The relayer is untrusted for integrity: `extDataHash` (with the chain id and pool address) and `claimDataHash` (with the claim ciphertext) are bound into the proofs, so it can only submit or refuse. The executor is trusted for execution quality (slippage): a careless executor can give a batch a poor price but cannot take anything, because output goes to the pool and claims are proportional to what the pool received. If no executor clears a batch within an hour, anyone can cancel it and every order is refunded. The proving keys are generated from fresh randomness that is discarded when the build exits, so no party holds the trapdoor.

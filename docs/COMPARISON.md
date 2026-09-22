# Elysian compared

How Elysian relates to the systems it learned from. Claims about other projects are drawn from their public documentation as of September 2026; check them before quoting.

| | Elysian | Railgun | Zcash (Orchard) | Aztec | Penumbra | NEAR Intents |
| --- | --- | --- | --- | --- | --- | --- |
| Runs on | Robinhood Chain (Arbitrum Orbit L2 on Ethereum) | Ethereum, Arbitrum, BNB Chain, Polygon | Its own L1 | Its own L2 on Ethereum | Its own Cosmos chain | NEAR, cross-chain via solvers |
| Assets | Any ERC-20 on the chain; 194 Robinhood stock tokens registered | Any ERC-20 | ZEC | Tokens bridged in | IBC assets | Anything a solver will fill |
| State model | UTXO notes, Poseidon tree | UTXO notes | UTXO notes | Private notes and public state | UTXO notes | Accounts and intents |
| Private trading | Sealed batches per pair, uniform clearing price against Uniswap | Adapt modules call a public DEX with a hidden caller | None on-chain; Zashi routes through NEAR Intents | Private contract calls | ZSwap sealed batches with net-flow disclosure | Solver auctions, no proofs |
| Proving | In the browser, Groth16 over BN254 (27k constraints) | In the browser, Groth16 | In the wallet, Halo 2 | Client-side PXE, Honk | Client, Groth16 on BLS12-377 | Not applicable |
| Disclosure | Full viewing key: sees notes, memos, spends; cannot spend | Viewing keys | Viewing keys, diversified addresses | Application-defined | Full viewing keys | Not applicable |
| Relayed submission | Node relayer; recipient and fee bound into the proof | Broadcasters | Not needed | Fee-payment contracts | Native to the chain | Solvers |
| Compliance surface | Stock-token blocklist is enforced by the token on every exit; the pool never bypasses it | Private Proofs of Innocence | None | None | None | KYC-free by design |
| Batch cadence | 60 seconds, configurable | None | None | None | One block | Per intent |
| Trust for execution | Named executors; an uncleared batch can be cancelled and refunded by anyone after one hour | None | None | Sequencer | Validators | Solver reputation |

## Where Elysian is narrower

- One asset per transaction. Multi-asset join-splits are a circuit change.
- Swap sizes are public per intent (Penumbra's model). Hiding them needs homomorphic value commitments per batch.
- No cross-chain reach. Elysian settles where the stock tokens live.

## Where Elysian is wider

- Sealed batch trading against an external venue on an EVM chain, not a bespoke chain.
- Any ERC-20 without registration, including the tokenized equities Robinhood issues, with the token's own compliance rules respected instead of wrapped away.
- A single `transact` entry point covers shield, transfer, unshield and adapter routing, so every new adapter inherits the same anonymity set.

## Layer-2 privacy in general

Most L2s (Arbitrum, Base, Optimism, zkSync) are transparent by construction: rollup proofs attest to correct execution, not to secrecy. Robinhood Chain is one of them. Elysian adds a privacy layer inside such a chain rather than replacing it: the settlement, bridging and data availability guarantees stay exactly as Arbitrum Orbit provides them, and the shielded pool lives as ordinary contracts on top.

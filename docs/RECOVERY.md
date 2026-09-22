# Recovering notes from the version 1 pool

Version 2 changed the key derivation message (so version 2 keys differ from version 1 keys), bound every proof to its chain and contract, and moved to new proving keys. The app speaks version 2 only; it refuses to talk to a version 1 deployment rather than produce proofs that cannot verify there.

Notes that were shielded in the version 1 pool (`contracts/deployments/archive/robinhood-v1.json`) are withdrawn with the recovery tool, which uses the archived version 1 proving keys (`circuits/archive/v1-2026-09-21`) and the version 1 hash:

```bash
WALLET_KEY=0x… DRY=1 npx tsx node/scripts/exit-v1.ts   # sign the version 1 message, scan the version 1 pool, report balances
WALLET_KEY=0x… npx tsx node/scripts/exit-v1.ts         # then withdraw everything to that wallet
```

The tool derives the version 1 keys from the same wallet signature the version 1 app used, reads the pool's events straight from the chain (no node needed), builds the tree locally, proves with the archived keys and submits `transact` from the wallet. Set `SPENDING_KEY` to use a raw version 1 spending key instead, and `RECIPIENT` to withdraw somewhere other than the paying wallet. Shield the withdrawn tokens again in the version 2 app.

The tool exits notes and reports any unclaimed version 1 orders it finds for the key; it does not claim them, because that needs the version 1 claim circuit. The version 1 pool saw four orders and three claims; the unclaimed one was placed with test keys that were discarded, and holds no recoverable value.

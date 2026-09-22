# Elysian protocol

Version 2. The circuits and contracts are normative; this document explains them. Version 2 binds every proof to its chain and contract, binds a claim to the ciphertext it stores, and fixes the size of note plaintexts.

## 1. Field and hashes

All circuit arithmetic is over the BN254 scalar field `p = 21888242871839275222246405745257275088548364400416034343698204186575808495617`. Every hash inside the protocol is Poseidon (circomlib parameters) with a small integer domain separator as the first input:

| Domain | Use |
| --- | --- |
| 1 | spend authority `ak` |
| 2 | nullifier key `nk` |
| 3 | note nullifier |
| 4 | swap commitment |
| 5 | swap nullifier |

The empty leaf of both trees is `keccak256("elysian") mod p`.

## 2. Keys

```
sk        random scalar, or keccak256(walletSignature) mod p
ak      = Poseidon(1, sk)
nk      = Poseidon(2, sk)
pk      = Poseidon(ak, nk)
encPriv = HKDF-SHA256(ikm = sk, info = "elysian/enc/v1", 32 bytes)   x25519 secret
encPub  = x25519(encPriv)
```

| Object | Contents | Can |
| --- | --- | --- |
| Spending key | `sk` | everything |
| Full viewing key | `ak, nk, encPriv` | decrypt incoming notes, derive nullifiers, detect spends |
| Address | `pk, encPub` | receive |

Encodings are bech32m with a 1024-character limit: addresses under `elysian`, viewing keys under `elysianview`.

The reference wallet signs `KEY_DERIVATION_MESSAGE(chainId)` (see `packages/core/src/constants.ts`; it names the chain id and the derivation version, and says in plain words that the signature is the spending secret) with EIP-191 and hashes the 65-byte signature. Wallets that produce non-deterministic signatures (some smart accounts) cannot use this derivation and must store `sk`. The key is held in memory only.

## 3. Assets

An asset is identified by its ERC-20 address, `assetId = uint160(token)`. There is no registry and no allowlist: any ERC-20 on the chain can be shielded. The pool assumes `transferFrom` moves exactly the requested amount, so fee-on-transfer and rebasing tokens are out of scope. Native ETH enters as WETH.

## 4. Notes

```
note        = (asset: uint160, amount: uint120, pk, blinding)
commitment  = Poseidon(amount, asset, pk, blinding)
nullifier   = Poseidon(3, nk, commitment, leafIndex)
```

Plaintext serialization, always 198 bytes: `0x02 ‖ asset(20) ‖ amount(16) ‖ blinding(32) ‖ memoLength(1) ‖ memo(utf-8, zero-padded to 128)`. Every ciphertext is the same length, so a memo, a payment, change and padding are indistinguishable from outside. (Version 1 plaintexts had no leading version byte and a variable-length memo; wallets still read them.)

Encryption to `encPub`: ephemeral x25519 `e`, shared secret `s = x25519(e, encPub)`, key `= HKDF-SHA256(s, salt = ePub ‖ encPub, info = "elysian/note/v1")`, XChaCha20-Poly1305 with a random 24-byte nonce. Ciphertext `= ePub(32) ‖ nonce(24) ‖ sealed`. A wallet scans by attempting decryption of every ciphertext and accepting a note only when the recomputed commitment equals the on-chain leaf.

## 5. Transaction circuit

`Transaction(levels = 20, nIns = 2, nOuts = 2, amountBits = 120)`

Public inputs, in order: `root, publicAmount, extDataHash, assetId, inputNullifier[2], outputCommitment[2]`.

Private: `sk, inAmount[2], inBlinding[2], inPathIndices[2], inPathElements[2][20], outAmount[2], outPk[2], outBlinding[2]`.

Constraints:

1. `ak, nk, pk` derived from `sk`.
2. For each input: commitment recomputed with `pk` and `assetId`; nullifier recomputed and matched; Merkle root recomputed and forced equal to `root` only when `inAmount ≠ 0`; `inAmount < 2^120`.
3. For each output: commitment recomputed and matched; `outAmount < 2^120`.
4. The two input nullifiers differ.
5. `Σ inAmount + publicAmount = Σ outAmount` in the field.
6. `extDataHash` is squared to keep it in the constraint system.

A zero-amount input is a dummy: its commitment still exists as a value, its nullifier is unique because its blinding is random, and it is never checked against the tree.

## 6. Pool contract

`ElysianPool.transact(Proof args, ExtData extData)`:

```
Proof   { bytes proof; bytes32 root; bytes32[2] inputNullifiers; bytes32[2] outputCommitments;
          uint256 publicAmount; uint256 assetId; bytes32 extDataHash }
ExtData { address recipient; int256 extAmount; address relayer; uint256 fee;
          bytes encryptedOutput1; bytes encryptedOutput2; bytes adapterData }
```

Checks, in order: `extAmount > 0` pulls tokens from `msg.sender`; `root` is among the last 100 roots; both nullifiers unspent; `extDataHash == keccak256(abi.encode(extData) ‖ abi.encode(block.chainid, address(this))) mod p`, so a proof is valid on exactly one pool; `publicAmount == calculatePublicAmount(extAmount, fee)`; proof verifies. Then nullifiers are recorded, outputs inserted, tokens pushed to `recipient` if `extAmount < 0`, the adapter hook called if `recipient` is a registered adapter, and `fee` paid to `relayer`.

`calculatePublicAmount(extAmount, fee) = extAmount - fee`, mapped to `p - |x|` when negative. Both are bounded by `2^120`.

Stock tokens revert transfers involving blocklisted addresses. Because the token transfer happens after the nullifier writes, a blocked exit reverts the whole transaction and nothing is spent.

## 7. Sealed batch swaps

`ElysianSwap` is a registered adapter with its own depth-20 tree.

Intent (`adapterData = abi.encode(assetOut, ownerTag, batchId, ciphertext)`):

```
ownerTag       = Poseidon(4, pk, blinding)                                   chosen by the owner
swapCommitment = H(H(H(H(ownerTag, amountIn), batchId), assetIn), assetOut)   H = Poseidon2, built by the contract
```

The owner supplies only the tag. The adapter folds in the amount the pool actually delivered, the batch and the pair, so the leaf cannot overstate an order. It requires `batchId ∈ {currentBatch, currentBatch + 1}` where `currentBatch = block.timestamp / batchDuration`, adds `amountIn` to `batches[keccak(assetIn, assetOut)][batchId].totalIn`, inserts the commitment, and emits `SwapIntent` with the ciphertext (`batchId(8) ‖ assetIn(20) ‖ assetOut(20) ‖ amountIn(16) ‖ blinding(32)`, encrypted to the owner).

Execution: once `batchId < currentBatch`, an executor calls `executeBatch(assetIn, assetOut, batchId, minOut)`. The adapter approves the venue, the venue delivers `assetOut` to the pool, `totalOut` is set to what the pool actually received (which must be at least `minOut`), and the batch is marked executed. Only registered executors may execute, because the caller sets the slippage floor.

Cancellation: `cancelBatch(assetIn, assetOut, batchId)` returns a closed batch's `totalIn` to the pool and marks it executed and refunded with `totalOut = totalIn`. Executors may cancel at once; one hour after the batch closes anyone may, so no order can stay stuck. Claims against a refunded batch pay out in `assetIn`, one for one.

The venue can be replaced through `proposeDex` followed by `setDex` two days later, and the pool accepts a new adapter only two days after `proposeAdapter` once it holds any deposit.

Claim circuit `SwapClaim(levels = 20, amountBits = 120)`, public inputs `claimDataHash, swapRoot, batchId, assetIn, assetOut, payoutAsset, totalIn, totalOut, swapNullifier, outputCommitment`. The contract computes `claimDataHash = keccak256(abi.encode(block.chainid, address(this), encryptedOutput)) mod p` from the ciphertext in calldata, so the ciphertext stored beside the new commitment is exactly the one the claimant proved, and sets `payoutAsset` to `assetOut`, or to `assetIn` for a refunded batch:

```
swapNullifier    = Poseidon(5, nk, swapCommitment)
amountIn · totalOut = amountOut · totalIn + remainder,   0 ≤ remainder < totalIn
outputCommitment = Poseidon(amountOut, payoutAsset, pk, outBlinding)
```

All five quantities are range-checked to 120 bits so the products stay below `p`. The contract reads `totalIn` and `totalOut` from storage, verifies the proof, records the nullifier, and calls `pool.insertFromAdapter(outputCommitment, ciphertext)`.

Rounding dust (`Σ remainder / totalIn` per batch, at most one unit per claim) stays in the pool.

## 8. Disclosure profile

| | Public | Private |
| --- | --- | --- |
| Shield | asset, amount, depositor address | owner |
| Transfer | asset, 2 nullifiers, 2 commitments, 2 ciphertexts, relay fee (flat per asset) | everything else |
| Unshield | asset, amount, recipient, relayer, fee | spent notes |
| Intent | pair, amountIn, batch, commitment, ciphertext | owner |
| Claim | batch, pair, nullifier, output commitment | which intent, when the batch held more than one order |

Amounts of intents are public by design (Penumbra's model). Hiding them requires homomorphic value commitments per batch and is left for a later version. A batch with a single order is that order: its size, output and claim follow from the batch totals.

Wallets mirror both trees from the node's ordered commitment log, take batch totals from its batch feed, and build Merkle paths locally; the per-transaction chain read is the generic `isKnownRoot`. The trade page's indicative quote does send the pair and size to the RPC before the order is placed. Sends, orders and claims are relayed by default, so the owner's wallet address never signs them. Proving artifacts are served under `/circuits/v2/`, and a deployment record carries its protocol version; the app refuses a deployment of another version. Version 1 notes are withdrawn with `node/scripts/exit-v1.ts` (see `docs/RECOVERY.md`).

## 9. Parameters

| | |
| --- | --- |
| Tree depth | 20 (1,048,576 leaves per tree) |
| Root history | 100 |
| Inputs / outputs | 2 / 2 |
| Amount bound | 2^120 |
| Batch duration | 60 s (constructor parameter) |
| Cancel grace (anyone may cancel) | 1 h |
| Venue and adapter change delay | 2 days |
| Proof system | Groth16, BN254, snarkjs |
| Transaction circuit | 27,305 constraints |
| Swap claim circuit | 16,719 constraints |

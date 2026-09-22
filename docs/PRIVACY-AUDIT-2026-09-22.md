**Elysian privacy and explorer audit — 22 September 2026**

**Verdict: Elysian is not currently at parity with Monero or fully shielded Zcash usage, and it does not provide the strongest privacy its existing architecture could support.** There are avoidable wallet and API leaks, overstated explorer assurances, and a reproduced claim-recovery vulnerability. The basic shielded-note architecture provides useful protections, but the complete user journey defeats some of them.

This is a source review with functional tests, targeted reproduction, read-only mainnet observations through the running node, and local browser checks. It is not an independent cryptographic certification or a claim that every vulnerability has been found. “Up to standards” here means the concrete privacy and explorer criteria below, not certification against a regulatory standard.

**Scope and evidence**

Reviewed the core key/note/encryption/witness code, both Circom circuits, pool and swap contracts, setup script, wallet submission/synchronization, node/indexer/API, explorer, and privacy claims. The tree was already untracked in Git; there was no committed revision to use as an audit baseline. Application source was not modified. Audit artifacts are under [audit](audit/).

The existing local production server at `http://localhost:3002` and node at `http://127.0.0.1:8788` were inspected. The node reports Robinhood Chain 4663 and the deployed addresses in `contracts/deployments/robinhood.json`. Its captured dataset contains 26 transactions, 41 commitments, four swap intents, four executed batches and three claims. All four batches contain exactly one order. This is a small, early dataset, not a measure of future adoption or a count of distinct users.

Both deployed verifier runtime bytecodes exactly matched the local compiled verifier artifacts when read through the application's mainnet RPC route. This does not establish a full reproducible source-to-deployment chain for every contract, circuit or browser artifact. The public hostname `elysian.chud.tech`, taken from the app metadata, failed DNS resolution here; public TLS, CDN headers, access logs and the public deployment's exact build remain unverified.

- [Captured API observations, ciphertext sizes and verifier comparison](audit/privacy-observations.json), captured at 14:35 UTC.
- [SHA-256 hashes of 19 reviewed source files](audit/source-hashes.json) identify the audited source snapshot independently of Git history.
- [Browser observations](audit/explorer-browser.json): home, claim, batch and viewing-key pages; no captured runtime exceptions; observed requests went only to the local app and node. A fresh synthetic viewing key was not found in observed requests after decryption. This checks the exercised path, not every possible future code path or hosting operator.
- [Home screenshot](audit/explorer-home.png) and [claim screenshot](audit/explorer-claim.png).
- Existing core tests: **5 passed**. Existing contract tests using real proofs: **13 passed**. One new isolated audit reproduction: **passed, confirming a vulnerability**.
- No real wallet keys were used, and no transaction was submitted to a live chain by this audit. Contract tests used an isolated Hardhat network. The in-app browser failed to initialize; browser QA used a separate headless Chrome instance.

**What is working**

The circuits constrain spend-key ownership, membership for nonzero inputs, nullifiers, conservation of value and amount ranges. The transaction proof binds external data, including its ciphertexts. Notes use fresh blinding; encryption uses ephemeral X25519, HKDF-SHA256 and authenticated XChaCha20-Poly1305. Scanning recomputes commitments before accepting decrypted notes. Proofs are built in a browser worker, and the viewing-key page decrypts locally. The reviewed node database stores public events rather than plaintext balances or spending keys. The HTTP application logger is disabled. No analytics integration was found in the reviewed app source.

These are useful properties. They do not hide EVM transaction senders, HTTP request metadata or information inferred from small anonymity sets.

**Comparison with the reference systems**

| Practice | Reference behavior | Elysian assessment |
| --- | --- | --- |
| Privacy by default | Monero mandates transaction privacy using sender ambiguity, one-time receiving outputs and confidential amounts. | Elysian is an optional pool on a transparent EVM chain. Depositors, exit recipients and boundary amounts remain public. Even within the wallet, direct submission exposes a public signer. [Monero FAQ](https://web.getmonero.org/get-started/faq/) |
| Hidden parties and value inside the pool | Fully shielded Zcash uses proofs and encrypted notes; transparent Zcash usage has a different disclosure profile. | Similar note-model intent, but path queries reveal the spent leaves to the node, trades use the connected EOA, and every transaction publishes its asset. [Zcash shielded/transparent distinction](https://z.cash/learn/what-is-the-difference-between-shielded-and-transparent-zcash/), [Zcash proofs](https://z.cash/learn/what-are-zk-snarks/) |
| Network privacy | Monero implements Dandelion++ and supports Tor/I2P workflows; remote nodes still introduce privacy tradeoffs. | Ordinary HTTP RPC, witness queries and relaying let the service correlate requests with network origin and timing. No comparable network protection or verified retention policy was demonstrated. [Dandelion++](https://web.getmonero.org/2020/04/18/dandelion-implemented.html), [remote-node guidance](https://web.getmonero.org/resources/moneropedia/remote-node.html) |
| Key separation and address diversity | Orchard separates viewing capabilities and supports diversified addresses and hierarchical accounts. | Elysian separates viewing from spending, but the reference wallet exposes one deterministic address per wallet/chain and exports only a broad full viewing key. Its custom Poseidon/BN254 hierarchy is not Orchard cryptography. [Orchard keys](https://zcash.github.io/orchard/design/keys.html) |
| Uniform metadata | Zcash's memo field has a fixed 512-byte encoding, including padding/no-memo representation. | Elysian ciphertext length reveals exact memo byte length; output position also identifies the reference wallet's payment/change roles. [ZIP 302](https://zips.z.cash/zip-0302) |
| Setup assurance | Zcash's Halo proving system removes reliance on trusted setup ceremonies. | Elysian uses Groth16 with all phase-two contributions generated by one process. That is a materially different trust assumption. [Zcash Halo](https://z.cash/learn/what-is-halo-for-zcash/) |
| Multi-asset and trading disclosure | Penumbra hides asset type on internal transfers; its current guide explicitly says swaps reveal input/output assets and amounts. | Public swap sizes are not, by themselves, evidence that Elysian miscopied Penumbra. However, Elysian additionally exposes the submitting EOA through its trading UI and reveals asset identity on internal transfers. [Penumbra privacy guide](https://guide.penumbra.zone/overview/privacy) |

These systems are useful engineering references, not guarantees of perfect anonymity. Copying primitive names or adding ring signatures would not repair Elysian's wallet/API leaks.

**Findings — high priority**

**P1-01: Witness requests disclose the exact notes being spent to the node.**

Evidence: `web/src/lib/wallet/actions.ts:96` calls `nodeApi.path(n.leafIndex)` for each real input; line 222 calls `nodeApi.swapPath(swap.leafIndex)` for a claim. `web/src/lib/node.ts` places these indices in URL paths. The same service offers the relay and claim endpoints.

An observing node or its reverse proxy learns exactly which original commitments a client is about to spend, including the number of real inputs. A swap-path request exposes the particular order being claimed. Correlating these requests with submission time and network origin defeats the relationship that the proof hides from passive chain observers. Turning off Fastify logs does not prevent the service from learning it. TLS protects transport, not the destination service.

Fix: construct witnesses from the local tree, which the wallet already maintains, after complete generic synchronization; verify roots against a trusted chain source at a consistent block. Remove note-specific requests from the ordinary send/trade/claim paths. Acceptance: a network trace of these operations contains no input leaf IDs, note commitments used as private lookup keys, or identifying swap-path queries.

**P1-02: Trading directly exposes the connected public wallet; relayer absence also weakens sends and claims.**

Evidence: `web/src/app/app/trade/page.tsx:87` unconditionally uses `writeContractAsync` from the connected wallet. Lines 104 and 145 nevertheless say batch participants/intent ownership are hidden. `web/src/app/app/send/page.tsx:54` and line 93 select direct submission when a relayer is unavailable; the checkbox becomes disabled and the button can still say “Send privately.” Claims similarly fall back at `trade/page.tsx:190`.

Every observer can read the transaction signer. Under this reference-wallet workflow, that signer is directly associated with the trade or spend. A raw `from` address alone is not mathematical proof of note ownership: arbitrary relayers can submit proofs. The observed mainnet sample uses one address that is also the node's configured relayer, so the sample alone cannot distinguish end users from operator/test activity. The unconditional UI submission path is the decisive evidence for the defect.

Fix: relay trades as well as sends/claims; make privacy mode stop when relaying is unavailable. If direct submission is deliberately offered, explain its actual signer disclosure before signing. Separate operator and user identities in testing so relay behavior is verifiable. Acceptance: a fresh user's public EOA is absent from the outer transactions for all shielded operations in privacy mode.

**P1-03: Single-order batches make claim/order linkage and payout amounts public by inference.**

Evidence: the claim circuit publishes batch ID, pair and totals (`circuits/src/swapClaim.circom:19`); `ElysianSwap.sol:50` publishes each intent's size. All four observed batches have one order. The three claims can each be assigned to their sole intent. For example, batch `29833653` pays **984369 raw USDG = 0.984369 USDG** into commitment index 38, although its claim page hides the received amount. The calculation is `floor(amountIn * totalOut / totalIn)`; with one order it equals `totalOut`.

The explorer's unconditional assertions that the order and amount are hidden are false in this case. Larger order counts are still only an upper bound on anonymity: an adversary may control other orders, and timing/amount correlations can narrow candidates further. Commitment count is not a count of independent users and includes dummy notes.

Fix: show the batch candidate count and warn when it is one; distinguish cryptographically concealed fields from publicly inferable values. Design stronger batch anonymity separately: longer/adaptive collection, broader claim sets or an audited protocol redesign may help, but a minimum order count alone is vulnerable to Sybil participation. Historical public data cannot be made private by changing the explorer.

**P1-04: A claim's ciphertext can be replaced without invalidating its proof. Reproduced.**

Evidence: `ElysianSwap.sol:194` verifies nine public inputs and later inserts `args.encryptedOutput` at line 221. Neither the circuit nor a separate owner authorization binds those bytes. This differs from pool transactions, whose external-data hash includes their ciphertexts.

An untrusted relayer that receives a valid claim can replace `encryptedOutput`, submit the same proof, and consume the claim nullifier. Normal scanning then cannot reconstruct the output note; submitting the correct ciphertext later fails as already claimed. Anyone who obtains the pending claim and can submit it first has the same capability, although sequencer/mempool access was not assessed here.

The [isolated reproduction](audit/claim-ciphertext.test.ts) submitted an empty ciphertext from another signer, observed successful claim acceptance, observed rejection of the original claim, and confirmed scanning no longer found the output. It also confirmed that retaining the original encrypted note data permits recovery. This is a recovery/availability attack, not proof of theft or decryption. It can become permanent loss for a scan-only wallet after its original output randomness is discarded.

Fix: cryptographically bind the ciphertext and relevant transaction domain to the claim authorization. Review and migrate the circuit/verifier/contract together; do not merely regenerate keys or alter the UI. Preserve existing funded-contract recovery and exit paths. Acceptance: altering one ciphertext byte or removing it must invalidate the authorized claim.

**P1-05: Key lifecycle does not match the promised isolation.**

Evidence: `web/src/lib/wallet/store.tsx:84` restores the raw spending key from `sessionStorage`; line 104 writes it there. `web/src/app/app/keys/page.tsx:75` says the key is held in memory only. Any executing same-origin script can read this stored value; it survives page reloads and is linked in the storage key to the public EOA and chain. This expands exposure; no XSS exploit was established.

There is also an account-transition defect: when switching directly from account A to account B without a stored B key, the restoration effect only changes state if it finds a key. It does not clear A's key. `isConnected` can remain true, so the disconnect effect does not help. Asynchronous derivation can also complete after the selected identity changes. These are source-confirmed state-lifecycle issues; an injected-wallet transition test was not performed. The tree and synchronization state are also not scoped/reset to a deployment.

Fix: keep spend secrets in a dedicated wallet boundary or genuinely ephemeral memory, lock on identity/deployment changes, cancel stale derivations, scope scan state correctly, and provide encrypted recovery independent of incidental browser storage. Memory-only JavaScript still does not protect against arbitrary malicious same-origin code. Acceptance: account/chain changes cannot display, restore or spend with the preceding identity's key.

**P1-06: Setup provenance and release assurance are insufficient for parity claims.**

Evidence: `circuits/scripts/build.mjs:67` generates two contributions and a beacon inside the same process, using its own random bytes. Those are not independent ceremony participants, and the beacon is not externally verifiable public randomness. No independent audit report, public phase-two ceremony transcript or signed source/circuit/key/verifier release manifest was found in the reviewed repository.

This does not prove toxic waste was retained or that existing proofs can be forged. It means users must trust the setup operator/environment to erase it. Retained setup secrets primarily threaten proof soundness and funds, not automatic note decryption. Standard Groth16 itself is not the defect.

Fix: commission review of the custom circuit/key design, establish independently verifiable setup provenance if retaining Groth16, publish artifact hashes and deployed-code mappings, and plan any necessary migration. The build's existing refusal to overwrite keys after a mainnet deployment is a useful safeguard and must be preserved.

**Findings — additional privacy improvements**

| ID | Severity | Evidence and consequence | Required improvement |
| --- | --- | --- | --- |
| P2-01 | Medium | `packages/core/src/note.ts:52` appends an unpadded memo. Measured ciphertext sizes are 140, 145 and 268 bytes for 0, 5 and 128 memo bytes. `actions.ts:161` always places recipient output first, then change/dummy. This reveals memo length and predictable output roles, not memo contents. | Use a versioned fixed-size plaintext layout, pad real/dummy outputs identically, randomize output order with secure randomness, and preserve scanning of historical notes. |
| P2-02 | Medium | RPC reads, amount-specific quote requests, `/path`, `/relay`, `/claim` and explorer searches share observable request timing and client origin. Public `assetId` partitions plausible note sets by asset; rare tokens and immediate exact-amount deposits/exits are particularly weak. | Provide supported private transport/self-hosting, minimize logs at proxies/CDNs as well as the app, reduce identifying request patterns, separate services where useful, and describe the remaining trust model. Address public asset IDs only through a reviewed protocol redesign. |
| P2-03 | Medium | `packages/core/src/constants.ts:38` tells users the derivation signature “cannot move funds,” but `SpendingKey.fromSignature` turns the signature bytes into the spending key. A site that obtains that exact signature obtains the same spend authority. Ordinary EIP-191 signing is not intrinsically bound to the requesting website. | Correct the signing warning. Prefer a wallet-controlled secret derivation or independent shielded seed and recovery scheme; review smart-wallet/signature determinism. Adding an origin string alone does not prevent a malicious site requesting identical text. |
| P2-04 | Medium | The reference wallet has no diversified receiving-address flow or narrower viewing-key export. Sharing a full viewing key exposes past and future notes under that identity and spend detection; it does not reconstruct every outgoing recipient/payment as an accountant might assume. | Add scoped disclosure/payment proofs, diversified accounts/addresses where justified, and clear documentation of disclosure scope and lack of retroactive revocation. Do not claim address reuse by itself makes encrypted commitments publicly linkable. |

**Explorer assessment**

The desktop interface is usable and visually coherent, with transaction metadata, receipts, token movements, pagination and contract links. Showing information already published on-chain is appropriate. Removing public values from this explorer would not remove them from RPC responses or other explorers.

| Criterion | Result | Evidence / correction |
| --- | --- | --- |
| Local viewing-key decryption | Pass for the exercised path | Synthetic-key scan completed without transmitting the key in captured requests. React renders memo text rather than inserting it as HTML. |
| Truthful privacy labels | Fail, high priority | `web/src/app/explorer/tx/[hash]/page.tsx:13` hardcodes hidden sender/claimant/order/amount fields. Browser verified these labels on a singleton claim. Use transaction-specific statements and distinguish unpublished data, signer metadata and inference. |
| Truthful proof status | Fail, medium | Line 150 always renders “Groth16, verified on-chain.” Browser verified this on `executeBatch`, which does not verify a Groth16 proof. Show proof status only where receipt and called function justify it. |
| Count semantics | Fail, medium | `components/explorer/Action.tsx` describes two nullifiers as two spent notes. The protocol pads with dummy inputs, so the actual real input count is unknown. The home page similarly calls nullifiers “nullified” notes. Label commitments and nullifiers as those objects. |
| Complete viewing-key history | Fail, medium | `explorer/view/page.tsx:35` fetches commitments/swaps once, with the client's default limit of 5000, without pagination. Notes after that boundary are silently missed. Page through a consistent indexed height and show scan coverage before reporting balances. |
| Correct balances and errors | Fail, medium | Token decimals come from current holdings and only the newest 100 transactions; unknown tokens default to 18 decimals. A historical six-decimal token can display incorrectly. Network errors are labelled “Invalid viewing key,” and old orders can persist after failure. Resolve metadata for all discovered assets locally or via privacy-preserving generic metadata, clear stale results, and separate validation/sync errors. |
| Claim and cancellation accuracy | Fail, medium | `node/src/explorer.ts:156` assigns every claim's asset to `assetOut`, including refunded batches that pay `assetIn`. The UI labels every batch function `executeBatch`, even cancellations. Derive actual payout asset and decoded method. |
| Nullifier search completeness | Fail, low | `node/src/explorer.ts:25` searches pool nullifiers but not the separate claim-nullifier table. Claim detail also returns only pool nullifiers. Include swap claim nullifiers and their transaction mapping. |
| Raw evidence completeness | Partial | API truncates calldata after 1024 bytes and long log arguments; unknown events omit raw data. Provide full raw/downloadable data while keeping a shortened display. Receipt logs are not all represented as complete raw evidence. |
| Reorg/finality correctness | Fail, medium | `node/src/indexer.ts:14` resumes from a height with no stored block hashes or rollback; `tx_meta` assumes mined records never change. L2 block count is not L1 finality. Add canonical block checks, rollback/replay, cache invalidation and explicit confirmation/finality labels. No live reorg was induced. |
| Indexer transactional consistency | Fail, medium | Trees mutate during an SQLite transaction; an exception rolls back SQL but not tree state. A failure around final cursor persistence can similarly leave memory ahead. Stage mutations or rebuild on rollback, and test injected mid-range failures. |
| Browser hardening | Partial/fail locally | Local production response has no CSP, anti-framing policy or explicit referrer policy; config only adds circuit caching headers. External explorer links already use `noreferrer`. Add restrictive policies compatible with proving, an explicit clear/lock action for viewing-key results, and validate production edge headers separately. No public CDN conclusion is possible. |
| API resilience | Partial | Query limits lack lower-bound/integer validation (`Math.min(-1,100)` remains -1, which SQLite treats as unlimited); RPC calls are not consistently bounded/rate-limited. Relaying free transfers and claims has no visible abuse control. Validate schemas and apply privacy-respecting resource controls. Public CORS alone is not a private-data leak. |

The viewing-key UI should be treated as a sensitive wallet surface even though its key cannot spend. A compromised web host can change downloaded JavaScript; no finding here establishes protection against that adversary. Serving proofs and decryption locally is necessary but not sufficient.

**Remediation order and acceptance**

1. **Correct the promises and stop avoidable disclosures:** local witness construction; relayed trades; explicit privacy-mode failure when a relay is unavailable; identity-scoped key lifecycle; accurate singleton/direct-signer explorer labels. Add network-capture regression tests that exercise a distinct user account and relayer.
2. **Review and remediate claim authorization:** reject modified claim ciphertexts, review domain binding, plan migration and recovery for existing users. Keep existing proving artifacts available; never overwrite keys while their funded contracts still rely on them.
3. **Make the explorer reliable:** complete scans, correct token metadata, cancelled-claim accounting, actual proof status, claim-nullifier lookup, reorg handling and SQL/tree rollback consistency. Test these with synthetic data and isolated failures.
4. **Improve sustained privacy:** padded messages, output randomization, scoped disclosures, transport/logging policy, deployment manifests and independent cryptographic review. Quantify anonymity per asset/batch rather than advertising total commitments as the anonymity set.

After the first items, Elysian could make a narrower, supportable claim: it conceals note ownership and internal transfer amounts from passive chain observers when users use the protected wallet path, subject to public asset/boundary metadata and anonymity-set limitations. The evidence does not support “without a trace,” “nobody sees who was in it,” or blanket Monero/Zcash parity today.

**Reproduction commands**

```powershell
npm.cmd run test:core
npm.cmd test
node docs/audit/privacy-observations.mjs
node docs/audit/explorer-browser.mjs
Set-Location contracts
..\node_modules\.bin\hardhat.cmd test ../docs/audit/claim-ciphertext.test.ts --no-compile
```

The observation scripts assume the already-running localhost services described above. The browser check needs Chrome at its standard Windows location and uses a temporary isolated profile. On this machine, core tests and headless Chrome required execution outside the restricted sandbox. The vulnerability reproduction deliberately succeeds against the current flawed implementation; after remediation its expectation must be changed to require rejection.

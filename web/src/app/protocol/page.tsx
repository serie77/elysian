import Link from 'next/link';
import { Nav } from '@/components/landing/Nav';
import { SmoothScroll } from '@/components/motion/SmoothScroll';
import { Reveal } from '@/components/motion/Reveal';
import { Grain } from '@/components/motion/Grain';

export const metadata = { title: 'Elysian · Protocol' };

const sections = [
  {
    n: '1',
    h: 'Model',
    p: [
      'Elysian is a shielded UTXO layer over ERC-20 tokens on Robinhood Chain. Value is held in notes. A note is a tuple (asset, amount, pk, blinding). Only its Poseidon commitment is published; it is appended to a depth-20 incremental Merkle tree held by ElysianPool.',
      'Spending a note publishes its nullifier, Poseidon(3, nk, commitment, leafIndex). Because nk is secret, observers cannot link a nullifier to the commitment it consumes. Because the leaf index is bound, the same note cannot be spent twice.',
      'A transaction consumes up to two notes and produces exactly two. It carries a public amount that may be positive (shield), negative (unshield or route to an adapter) or zero (transfer). The circuit enforces Σ in + publicAmount ≡ Σ out over the scalar field; the contract enforces that publicAmount equals extAmount minus the relayer fee.',
    ],
  },
  {
    n: '2',
    h: 'Keys',
    p: [
      'A spending key sk is a scalar. From it: ak = Poseidon(1, sk), nk = Poseidon(2, sk), pk = Poseidon(ak, nk). The circuit takes sk as a private witness and recomputes ak, nk and pk, so ownership of pk cannot be forged from public data.',
      'An encryption key is derived with HKDF-SHA256 from sk under the label elysian/enc/v1 and used as an x25519 secret. Note plaintexts are encrypted to the recipient with an ephemeral x25519 exchange and XChaCha20-Poly1305, and published beside the commitment. Wallets find their notes by trial decryption.',
      'A full viewing key is (ak, nk, encPriv). It decrypts every incoming note, recomputes pk, and derives every nullifier, so a holder can see balances and spends. It cannot satisfy the circuit, so it cannot spend. Addresses are bech32m encodings of pk and the encryption public key under the prefix elysian.',
      'In the reference wallet, sk is the keccak hash of an EIP-191 signature over a fixed message that names the chain id and the derivation version. The message says in plain words that whoever holds the signature can spend, and the app is the only place that should ask for it. The same wallet on the same chain always derives the same keys; the signature is never sent anywhere and the key is held in memory only, dropped when the tab, account or chain changes.',
    ],
  },
  {
    n: '3',
    h: 'Pool',
    p: [
      'ElysianPool.transact(proof, extData) verifies a Groth16 proof over BN254 with eight public inputs: root, publicAmount, extDataHash, assetId, two nullifiers and two output commitments. The root must be among the last 100 roots. Both nullifiers must be unspent and are marked before any token movement.',
      'extData carries the recipient, the signed external amount, the relayer, the fee, two note ciphertexts and adapter data. Its keccak hash, together with the chain id and the pool address, reduced into the field, is a public input: a relayer that submits the transaction cannot alter where value goes or how much it earns, and a proof made for one pool is worthless on any other chain or deployment.',
      'Positive extAmount pulls tokens from msg.sender before verification. Negative extAmount pushes tokens to the recipient after verification. If the recipient is a registered adapter, the pool then calls onShieldedTransfer with the adapter data. Adapters may later mint notes back into the tree through insertFromAdapter.',
      'Robinhood stock tokens consult an access-controls registry on every transfer. The pool does not bypass it: an unshield to a blocked address reverts, and the notes remain unspent because the revert unwinds the nullifier writes.',
    ],
  },
  {
    n: '4',
    h: 'Sealed batch swaps',
    p: [
      'A swap intent is a transaction whose recipient is ElysianSwap. The adapter data names the output asset, a batch id, a ciphertext for the owner, and an owner tag Poseidon(4, pk, blinding). The adapter records amountIn under the (assetIn, assetOut, batchId) key and builds the leaf itself from the amount it actually received, H(H(H(H(tag, amountIn), batchId), assetIn), assetOut), so an order can never claim to be larger than it was. The leaf goes into the adapter’s own tree.',
      'Batches are one minute long. When a batch closes, an executor clears the pair’s total input against a venue adapter (Uniswap v3 on Robinhood Chain) and records totalOut. The output tokens are delivered to the pool. If a batch cannot clear, it is cancelled and every order is refunded; after a one hour grace period anyone may cancel it.',
      'To claim, the owner proves knowledge of a commitment in the swap tree, publishes its nullifier Poseidon(5, nk, commitment), and proves that amountOut equals ⌊amountIn · totalOut / totalIn⌋ with a bounded remainder. The keccak hash of the chain id, the swap contract and the output ciphertext is a public input of the same proof, so the ciphertext the claimant wrote is the only one the contract will store beside the new commitment. Because claims prove membership rather than revealing an index, the chain cannot pair a claim with its intent when the batch held more than one order.',
      'What is public: the pair, each intent’s size, the batch totals and the clearing ratio. What is private: who submitted each intent and which claim followed it. This is the Penumbra ZSwap disclosure profile, without the need for a dedicated chain.',
    ],
  },
  {
    n: '5',
    h: 'Node',
    p: [
      'The Elysian node follows the pool and the swap adapter and stores commitments, nullifiers, ciphertexts and batches in SQLite. Wallets download that log in order, mirror both trees themselves and build their own Merkle paths, so the node never learns which leaf a proof uses; before proving, a wallet checks its mirrored root against the contract. The node holds only public data and any party can run one.',
      'With a funded key the node relays transactions whose extData names it as relayer and whose fee meets its minimum, so the gas payer is never the note owner. With an executor key it clears closed batches. Both roles are optional and permissionless to replicate.',
    ],
  },
  {
    n: '6',
    h: 'Guarantees and limits',
    p: [
      'Funds can always leave. An unshield needs only your own proof, no operator. A trade batch that cannot clear is cancelled and every order is paid back in full; after an hour anyone can trigger that. Changes to the contracts that can move funds take two days to come into force, in the open.',
      'Privacy grows with the pool. Sends, orders and claims go through the relayer by default, so your wallet address never signs a private action; sending from your own wallet is a choice the app spells out. For the strongest cover, shield round amounts, let notes rest before spending them, and trade sizes and times that others trade too.',
      'Amounts are bounded to 120 bits and every transaction is single-asset. Multi-asset join-splits, note consolidation and hidden intent sizes are natural extensions of the same circuits.',
    ],
  },
];

export default function ProtocolPage() {
  return (
    <main className="pb-32">
      <SmoothScroll />
      <Grain />
      <Nav />
      <div className="container-x pt-36">
        <Reveal>
          <p className="label label-bone mb-6">Protocol · specification</p>
        </Reveal>
        <Reveal as="h1" delay={80} className="display max-w-[14ch] text-[clamp(3rem,8vw,7rem)]">
          How Elysian <span className="soft">works.</span>
        </Reveal>
        <Reveal as="p" delay={160} className="mt-8 max-w-[60ch] text-[17px] leading-[1.6] text-[var(--ink-2)]">
          What Elysian publishes, what it proves, and what it keeps. The circuits and contracts are the source of truth.
        </Reveal>

        <div className="mt-24 grid gap-16 md:grid-cols-12">
          <nav className="hidden md:col-span-3 md:block">
            <ol className="sticky top-28 space-y-3">
              {sections.map((s) => (
                <li key={s.n}>
                  <a href={`#s${s.n}`} className="label hover:text-[var(--ink)]">
                    {s.n.padStart(2, '0')} · {s.h}
                  </a>
                </li>
              ))}
              <li className="pt-6">
                <Link href="/app" className="btn h-9 px-4 text-[12px]">
                  Launch app
                </Link>
              </li>
            </ol>
          </nav>
          <div className="space-y-20 md:col-span-8">
            {sections.map((s) => (
              <section key={s.n} id={`s${s.n}`}>
                <Reveal>
                  <div className="label mb-4 text-[var(--bone-2)]">{s.n.padStart(2, '0')}</div>
                  <h2 className="h2 text-[clamp(1.8rem,3.4vw,2.6rem)]">{s.h}</h2>
                </Reveal>
                <Reveal cascade step={90} className="mt-6 space-y-5">
                  {s.p.map((p, i) => (
                    <p key={i} className="will-reveal max-w-[66ch] text-[15.5px] leading-[1.7] text-[var(--ink-2)]">
                      {p}
                    </p>
                  ))}
                </Reveal>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

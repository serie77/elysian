/**
 * Protocol constants shared by the circuits, the contracts and every client.
 * Changing any value here is a consensus change.
 */

/** BN254 scalar field modulus (the field the circuits operate in). */
export const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Height of the note commitment tree and of the swap intent tree. */
export const TREE_LEVELS = 20;

/** Protocol version. Deployments, proving artifacts and the key derivation message all carry it. */
export const PROTOCOL_VERSION = 2;

/** Number of inputs / outputs in a shielded transaction. */
export const N_INPUTS = 2;
export const N_OUTPUTS = 2;

/** Amounts are range-checked to this many bits inside the circuits. */
export const AMOUNT_BITS = 120;
export const MAX_AMOUNT = (1n << BigInt(AMOUNT_BITS)) - 1n;

/** Poseidon domain separators. Distinct prefixes keep every hash use site disjoint. */
export const DOMAIN = {
  AK: 1n,
  NK: 2n,
  NULLIFIER: 3n,
  SWAP: 4n,
  SWAP_NULLIFIER: 5n,
} as const;

/** Leaf value of an empty tree slot: keccak256("elysian") mod p, computed in zero.ts. */
export const ZERO_LEAF_PREIMAGE = 'elysian';

/** Human readable prefixes for bech32m encodings. */
export const ADDRESS_HRP = 'elysian';
export const VIEWING_KEY_HRP = 'elysianview';

/** Deterministic key derivation message. Wallets sign this to derive a spending key. */
export const KEY_DERIVATION_MESSAGE = (chainId: number) =>
  `Elysian shielded key\n\nThis signature is the secret behind your Elysian keys: whoever holds it can spend your shielded balance. Only sign it on the Elysian app. It does not cost gas.\n\nChain: ${chainId}\nVersion: 2`;

/** The version 1 message, kept so notes in the version 1 pool can still be withdrawn (node/scripts/exit-v1.ts). */
export const KEY_DERIVATION_MESSAGE_V1 = (chainId: number) =>
  `Elysian shielded key\n\nThis signature derives your private Elysian keys. It does not cost gas and cannot move funds.\n\nChain: ${chainId}\nVersion: 1`;

/** Robinhood Chain network parameters. */
export const ROBINHOOD_CHAIN = {
  mainnet: {
    id: 4663,
    name: 'Robinhood Chain',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robin.etherscan.io',
    feed: 'wss://feed.mainnet.chain.robinhood.com',
    weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    uniswapV4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    /** Reported access-controls registry consulted by stock tokens on every transfer. */
    accessControlsRegistry: '0xe10b6f6b275de231345c20d14ab812db62151b00',
  },
  testnet: {
    id: 46630,
    name: 'Robinhood Chain Testnet',
    rpc: 'https://rpc.testnet.chain.robinhood.com',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    feed: 'wss://feed.testnet.chain.robinhood.com',
  },
} as const;

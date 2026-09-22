// Bridge the deployer's Ethereum-mainnet ETH to Robinhood Chain through the official Delayed Inbox.
// Deposits everything except the L1 gas reserve; the same address receives it on Robinhood Chain in about 15 minutes.
//   node scripts/bridge-eth.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

// docs.robinhood.com/chain/cross-chain-messaging. Checked on chain: bridge() and sequencerInbox() match the documented
// Bridge and SequencerInbox, bridge.rollup() is the documented Rollup, and rollup.chainId() is 4663.
const INBOX = '0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D';
const DEPOSIT_ETH = '0x439370b1'; // depositEth()

const account = privateKeyToAccount(env.DEPLOYER_KEY);
const transport = http(process.env.L1_RPC_URL ?? 'https://ethereum-rpc.publicnode.com');
const pub = createPublicClient({ chain: mainnet, transport });
const wallet = createWalletClient({ account, chain: mainnet, transport });

const balance = await pub.getBalance({ address: account.address });
const block = await pub.getBlock();
const maxPriorityFeePerGas = 50_000_000n; // 0.05 gwei
const maxFeePerGas = block.baseFeePerGas * 2n + maxPriorityFeePerGas;
const gas = ((await pub.estimateGas({ account, to: INBOX, data: DEPOSIT_ETH, value: 1n })) * 13n) / 10n;
const value = balance - gas * maxFeePerGas;
console.log(`${account.address}: ${formatEther(balance)} ETH on Ethereum; depositing ${formatEther(value)} ETH, keeping ${formatEther(gas * maxFeePerGas)} ETH for gas`);
if (value <= 0n) throw new Error('nothing left to deposit after gas');

const hash = await wallet.sendTransaction({ to: INBOX, data: DEPOSIT_ETH, value, gas, maxFeePerGas, maxPriorityFeePerGas });
console.log(`L1 tx https://etherscan.io/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 600_000 });
console.log(`L1 ${receipt.status} in block ${receipt.blockNumber}; the ETH lands on Robinhood Chain in about 15 minutes`);

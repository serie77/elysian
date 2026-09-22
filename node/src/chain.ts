import { createPublicClient, createWalletClient, defineChain, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { config } from './config.js';

export const robinhood: Chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://robin.etherscan.io' } },
});

export const robinhoodTestnet: Chain = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});

export const chain: Chain =
  config.chainId === 4663 ? robinhood : config.chainId === 46630 ? robinhoodTestnet : { ...hardhat, id: config.chainId };

export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

export const relayer = config.relayerKey
  ? createWalletClient({ chain, transport: http(config.rpcUrl), account: privateKeyToAccount(config.relayerKey) })
  : undefined;

export const executor = config.executorKey
  ? createWalletClient({ chain, transport: http(config.rpcUrl), account: privateKeyToAccount(config.executorKey) })
  : undefined;

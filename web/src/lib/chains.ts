import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
import { hardhat } from 'viem/chains';

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://robin.etherscan.io' } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});

export const localhost = { ...hardhat, name: 'Local' };

export const chains = [robinhood, robinhoodTestnet, localhost] as const;

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  transports: {
    // Reads go through our own relay, which attaches the provider key server side.
    [robinhood.id]: http('/api/rpc/4663'),
    [robinhoodTestnet.id]: http('/api/rpc/46630'),
    [localhost.id]: http('http://127.0.0.1:8545'),
  },
  ssr: true,
});

export function explorerFor(chainId: number): string {
  return chains.find((c) => c.id === chainId)?.blockExplorers?.default.url ?? '';
}

export function chainName(chainId: number): string {
  return chains.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
}

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}

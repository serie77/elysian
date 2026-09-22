import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import dotenv from 'dotenv';

// One .env at the repo root serves the contracts, the node and the web app.
dotenv.config({ path: '../.env', quiet: true });

const rpc = (alchemy: string, open: string) => (process.env.ALCHEMY_KEY ? `https://${alchemy}.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}` : open);
const MAINNET_RPC = rpc('robinhood-mainnet', 'https://rpc.mainnet.chain.robinhood.com');
const TESTNET_RPC = rpc('robinhood-testnet', 'https://rpc.testnet.chain.robinhood.com');

const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
    },
  },
  networks: {
    hardhat: process.env.FORK
      ? {
          chainId: 31337,
          forking: { url: MAINNET_RPC },
          // Hardhat has no built-in fork schedule for chain 4663; treat all of its history as Cancun.
          chains: { 4663: { hardforkHistory: { cancun: 0 } } },
        }
      : {
          chainId: 31337,
        },
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    robinhood: {
      url: MAINNET_RPC,
      chainId: 4663,
      accounts,
    },
    robinhoodTestnet: {
      url: TESTNET_RPC,
      chainId: 46630,
      accounts,
    },
  },
  etherscan: {
    apiKey: { robinhood: 'blockscout', robinhoodTestnet: 'blockscout' },
    customChains: [
      {
        network: 'robinhood',
        chainId: 4663,
        urls: { apiURL: 'https://robinhoodchain.blockscout.com/api', browserURL: 'https://robinhoodchain.blockscout.com' },
      },
      {
        network: 'robinhoodTestnet',
        chainId: 46630,
        urls: { apiURL: 'https://explorer.testnet.chain.robinhood.com/api', browserURL: 'https://explorer.testnet.chain.robinhood.com' },
      },
    ],
  },
  mocha: { timeout: 600_000 },
  typechain: { outDir: 'typechain-types', target: 'ethers-v6' },
};

export default config;

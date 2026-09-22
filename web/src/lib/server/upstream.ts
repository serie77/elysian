/** Server only. The Alchemy key lives in ALCHEMY_KEY and never reaches the browser; without one the public RPC is used. */
const NETWORKS: Record<string, { alchemy: string; open: string }> = {
  '4663': { alchemy: 'robinhood-mainnet', open: 'https://rpc.mainnet.chain.robinhood.com' },
  '46630': { alchemy: 'robinhood-testnet', open: 'https://rpc.testnet.chain.robinhood.com' },
};

export function upstream(chainId: string | number): string | undefined {
  const net = NETWORKS[String(chainId)];
  if (!net) return undefined;
  const key = process.env.ALCHEMY_KEY;
  return key ? `https://${net.alchemy}.g.alchemy.com/v2/${key}` : net.open;
}

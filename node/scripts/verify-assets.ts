/**
 * Audits every token the app lists against Robinhood Chain mainnet: contract exists, symbol and
 * decimals match what we show, supply is live, and the stock-token access registry answers.
 * Writes docs/asset-audit.json.
 *
 *   npx tsx node/scripts/verify-assets.ts
 */
import { createPublicClient, defineChain, http, parseAbi } from 'viem';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const RPC = process.env.ALCHEMY_KEY ? `https://robinhood-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}` : 'https://rpc.mainnet.chain.robinhood.com';
const REGISTRY = '0xe10b6f6b275de231345c20d14ab812db62151b00';

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});
const client = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000 }) });

const erc20 = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function uiMultiplier() view returns (uint256)',
]);
const registryAbi = parseAbi(['function isBlocked(address) view returns (bool)']);

const stocks = JSON.parse(fs.readFileSync(path.join(root, 'web/src/lib/robinhood-assets.json'), 'utf8')) as { symbol: string; name: string; address: `0x${string}` }[];
const listed = [
  { symbol: 'USDG', name: 'Global Dollar', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as `0x${string}` },
  { symbol: 'WETH', name: 'Wrapped Ether', address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as `0x${string}` },
  ...stocks,
];

const block = await client.getBlockNumber();
console.log(`auditing ${listed.length} tokens on chain ${await client.getChainId()} at block ${block}`);

const results: Record<string, unknown>[] = [];
const CHUNK = 40;
for (let i = 0; i < listed.length; i += CHUNK) {
  const slice = listed.slice(i, i + CHUNK);
  const calls = slice.flatMap((t) => [
    { address: t.address, abi: erc20, functionName: 'symbol' as const },
    { address: t.address, abi: erc20, functionName: 'decimals' as const },
    { address: t.address, abi: erc20, functionName: 'totalSupply' as const },
    { address: t.address, abi: erc20, functionName: 'uiMultiplier' as const },
  ]);
  const res = await client.multicall({ contracts: calls, allowFailure: true });
  slice.forEach((t, j) => {
    const [sym, dec, supply, mult] = res.slice(j * 4, j * 4 + 4);
    const symbol = sym.status === 'success' ? (sym.result as string) : null;
    const decimals = dec.status === 'success' ? Number(dec.result) : null;
    const totalSupply = supply.status === 'success' ? (supply.result as bigint) : null;
    const ok = symbol !== null && decimals !== null && totalSupply !== null;
    results.push({
      listed: t.symbol,
      address: t.address,
      onchainSymbol: symbol,
      decimals,
      totalSupply: totalSupply?.toString() ?? null,
      uiMultiplier: mult.status === 'success' ? (mult.result as bigint).toString() : null,
      symbolMatches: symbol === t.symbol,
      erc20: ok,
    });
  });
}

let registryAnswers = false;
try {
  const blocked = await client.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'isBlocked', args: ['0x000000000000000000000000000000000000dEaD'] });
  registryAnswers = true;
  console.log(`access registry answers: isBlocked(0x…dEaD) = ${blocked}`);
} catch {
  console.log('access registry did not answer isBlocked()');
}

const erc20Ok = results.filter((r) => r.erc20).length;
const symbolOk = results.filter((r) => r.symbolMatches).length;
const dec18 = results.filter((r) => r.decimals === 18).length;
const live = results.filter((r) => r.totalSupply && r.totalSupply !== '0').length;
const scaled = results.filter((r) => r.uiMultiplier).length;
console.log(`ERC-20 interface answers: ${erc20Ok}/${results.length}`);
console.log(`symbol matches listing:   ${symbolOk}/${results.length}`);
console.log(`18 decimals:              ${dec18}/${results.length}`);
console.log(`non-zero supply:          ${live}/${results.length}`);
console.log(`ERC-8056 uiMultiplier:    ${scaled}/${results.length}`);
const bad = results.filter((r) => !r.erc20 || !r.symbolMatches);
if (bad.length) console.log('needs attention:', bad.map((r) => `${r.listed}->${r.onchainSymbol}`).join(', '));

fs.writeFileSync(
  path.join(root, 'docs/asset-audit.json'),
  JSON.stringify({ chainId: 4663, block: block.toString(), checkedAt: new Date().toISOString(), registryAnswers, summary: { total: results.length, erc20Ok, symbolOk, dec18, live, scaled }, results }, null, 2),
);
console.log('wrote docs/asset-audit.json');

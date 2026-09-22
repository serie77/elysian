import robinhoodAssets from './robinhood-assets.json';
import type { Deployment } from './deployments';

export interface Asset {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  kind: 'stock' | 'stable' | 'eth' | 'meme' | 'demo' | 'custom';
}

/** Every Robinhood stock token live on chain 4663, from the public assets endpoint. */
export const STOCK_TOKENS: Asset[] = (robinhoodAssets as { symbol: string; name: string; address: string }[]).map((a) => ({
  symbol: a.symbol,
  name: a.name,
  address: a.address as `0x${string}`,
  decimals: 18,
  kind: 'stock',
}));

export const MAINNET_BASE: Asset[] = [
  { symbol: 'USDG', name: 'Global Dollar', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6, kind: 'stable' },
  { symbol: 'WETH', name: 'Wrapped Ether', address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', decimals: 18, kind: 'eth' },
];

/** Launchpad coins people actually trade on the chain (long.xyz, Pons). Addresses checked against mainnet. */
export const MEMECOINS: Asset[] = [
  { symbol: 'PONS', name: 'Pons', address: '0x39dBED3a2bd333467115dE45665cC57F813C4571', decimals: 18, kind: 'meme' },
  { symbol: 'AI', name: 'Artificial Inu', address: '0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18', decimals: 18, kind: 'meme' },
  { symbol: 'CASHCAT', name: 'Cash Cat', address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4', decimals: 18, kind: 'meme' },
  { symbol: 'ZZZ', name: 'ZZZ', address: '0x7dbf38976f6D3b9c529e7D9484A71898B409eE6a', decimals: 18, kind: 'meme' },
  { symbol: 'BONER', name: 'Boner Coin', address: '0x98096d17e191B3dA1d5f99a6D7b3584351b11E18', decimals: 18, kind: 'meme' },
  { symbol: 'MEME', name: 'A Meme Coin', address: '0x385F4f8ae47651ce5F58F5265395a669f8281e18', decimals: 18, kind: 'meme' },
  { symbol: 'ORBIO', name: 'Orbio.so', address: '0xAa07A0e9209e16aC99708C3EC70159c6eF3128A3', decimals: 18, kind: 'meme' },
];

export const FEATURED = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'COIN', 'SPCX', 'SPY', 'QQQ', 'MSTR', 'PLTR', 'AMD', 'NFLX', 'AVGO'];

/* ------------------------------- custom tokens ------------------------------- */

const customKey = (chainId: number) => `elysian.tokens.${chainId}`;

/** Tokens the user added by address, kept per chain in this browser. */
export function customTokens(chainId: number | undefined): Asset[] {
  if (!chainId || typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(customKey(chainId));
    return raw ? (JSON.parse(raw) as Asset[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomToken(chainId: number, asset: Asset): Asset[] {
  const list = customTokens(chainId).filter((a) => a.address.toLowerCase() !== asset.address.toLowerCase());
  list.push({ ...asset, kind: 'custom' });
  try {
    localStorage.setItem(customKey(chainId), JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  return list;
}

export function removeCustomToken(chainId: number, address: string): Asset[] {
  const list = customTokens(chainId).filter((a) => a.address.toLowerCase() !== address.toLowerCase());
  try {
    localStorage.setItem(customKey(chainId), JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  return list;
}

/** Registered assets for a chain plus whatever the user added. Any ERC-20 works; this is only the picker. */
export function assetsFor(chainId: number | undefined, deployment: Deployment | undefined, extra: Asset[] = []): Asset[] {
  const base: Asset[] =
    chainId === 4663
      ? [...MAINNET_BASE, ...MEMECOINS, ...STOCK_TOKENS]
      : Object.entries(deployment?.tokens ?? {}).map(([symbol, address]) => ({
          symbol,
          name: symbol === 'USDG' ? 'Global Dollar' : symbol === 'WETH' ? 'Wrapped Ether' : `${symbol} demo token`,
          address,
          decimals: 18,
          kind: symbol === 'USDG' ? 'stable' : symbol === 'WETH' ? 'eth' : 'demo',
        }));
  const seen = new Set(base.map((a) => a.address.toLowerCase()));
  return [...base, ...extra.filter((a) => !seen.has(a.address.toLowerCase()))];
}

export function findAsset(assets: Asset[], address: string | bigint): Asset | undefined {
  const addr = typeof address === 'bigint' ? `0x${address.toString(16).padStart(40, '0')}` : address;
  return assets.find((a) => a.address.toLowerCase() === addr.toLowerCase());
}

export function formatAmount(raw: bigint, decimals = 18, maxFraction = 4): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  const wholeStr = whole.toLocaleString('en-US');
  return `${neg ? '-' : ''}${wholeStr}${fracStr ? '.' + fracStr : ''}`;
}

export function parseAmount(input: string, decimals = 18): bigint {
  const s = input.trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') throw new Error('enter a number');
  const [w, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

export function short(address: string, n = 4): string {
  return `${address.slice(0, 2 + n)}…${address.slice(-n)}`;
}

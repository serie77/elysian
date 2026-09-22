/**
 * Downloads a logo for every listed stock token that has no Simple Icons mark, into public/tokens/stocks/<SYMBOL>.png,
 * and records which symbols got one in src/lib/stock-logos.json. Sources, in order: the nvstly/icons ticker set on
 * GitHub, then Financial Modeling Prep's image-stock endpoint. Logos are the trademarks of their companies, used to
 * identify the token; nothing here claims otherwise.
 *   node web/scripts/fetch-stock-logos.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = JSON.parse(readFileSync(resolve(here, '../src/lib/robinhood-assets.json'), 'utf8'));
const brand = JSON.parse(readFileSync(resolve(here, '../src/lib/token-icons.json'), 'utf8'));
const outDir = resolve(here, '../public/tokens/stocks');
mkdirSync(outDir, { recursive: true });

const sources = [(s) => `https://raw.githubusercontent.com/nvstly/icons/main/ticker_icons/${s}.png`, (s) => `https://financialmodelingprep.com/image-stock/${s}.png`];

async function fetchPng(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('image')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A real PNG, and not a placeholder so small it cannot be a logo.
    if (bytes.length < 400 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
    return bytes;
  } catch {
    return null;
  }
}

// Tickers both sources only have a photograph for; the monogram tile reads better.
const SKIP = new Set(['TSEM']);

const have = [];
const missing = [];
for (const { symbol } of assets) {
  if (symbol in brand || SKIP.has(symbol)) continue;
  const file = resolve(outDir, `${symbol}.png`);
  if (existsSync(file)) {
    have.push(symbol);
    continue;
  }
  let png = null;
  for (const src of sources) {
    png = await fetchPng(src(symbol));
    if (png) break;
  }
  if (png) {
    writeFileSync(file, png);
    have.push(symbol);
  } else missing.push(symbol);
}
have.sort();
writeFileSync(resolve(here, '../src/lib/stock-logos.json'), JSON.stringify(have, null, 2) + '\n');
console.log(`${have.length} stock logos on disk; ${missing.length} without one${missing.length ? ': ' + missing.join(' ') : ''}`);

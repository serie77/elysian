/**
 * Resolves each listed ticker to a real brand SVG where an open-licensed one exists, and writes
 * web/src/lib/token-icons.json. The mapping is explicit on purpose: a fuzzy match on company
 * names would eventually hand a token another company's logo.
 *
 *   node web/scripts/build-token-icons.mjs
 *
 * Sources: Simple Icons (CC0) via @iconify-json/simple-icons. Tickers with no entry fall back
 * to a monogram tile at render time.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const si = require('@iconify-json/simple-icons/icons.json');

const brand = {
  AAPL: 'apple', ADBE: 'adobe', AMD: 'amd', AMZN: 'amazon', AVGO: 'broadcom', BA: 'boeing', BABA: 'alibabadotcom',
  BB: 'blackberry', COIN: 'coinbase', CRCL: 'circle', CRM: 'salesforce', CSCO: 'cisco', CTSH: 'cognizant', DDOG: 'datadog',
  DELL: 'dell', DOCN: 'digitalocean', F: 'ford', FIG: 'figma', FTNT: 'fortinet', GE: 'generalelectric', GOOGL: 'google',
  IBM: 'ibm', INTC: 'intel', INTU: 'intuit', MDB: 'mongodb', META: 'meta', MSFT: 'microsoft', MSTR: 'microstrategy',
  NET: 'cloudflare', NFLX: 'netflix', NU: 'nubank', NVDA: 'nvidia', ORCL: 'oracle', PANW: 'paloaltonetworks', PATH: 'uipath',
  PLTR: 'palantir', QCOM: 'qualcomm', RBLX: 'roblox', RDDT: 'reddit', SHOP: 'shopify', SMCI: 'supermicro', SNAP: 'snapchat',
  SNDK: 'sandisk', SNOW: 'snowflake', SPCX: 'spacex', TEAM: 'atlassian', TSLA: 'tesla', TTWO: 'taketwointeractivesoftware',
  UPS: 'ups', WDC: 'westerndigital', ZM: 'zoom', WETH: 'ethereum',
};

const out = {};
const missing = [];
for (const [ticker, slug] of Object.entries(brand)) {
  const icon = si.icons[slug];
  if (!icon) {
    missing.push(`${ticker}:${slug}`);
    continue;
  }
  const d = icon.body.match(/ d="([^"]+)"/)?.[1];
  if (!d) {
    missing.push(`${ticker}:${slug} (no path)`);
    continue;
  }
  out[ticker] = d;
}

const file = resolve(here, '../src/lib/token-icons.json');
writeFileSync(file, JSON.stringify(out));
console.log(`wrote ${Object.keys(out).length} brand icons to ${file}`);
if (missing.length) console.log(`missing: ${missing.join(', ')}`);

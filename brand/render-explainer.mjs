// Renders brand/src/post-explainer.html at 2x with the token marks inlined. node brand/render-explainer.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const icons = JSON.parse(readFileSync(path.join(here, '../web/src/lib/token-icons.json'), 'utf8'));
const src = readFileSync(path.join(here, 'src/post-explainer.html'), 'utf8').split('__NVDA__').join(icons.NVDA).split('__AAPL__').join(icons.AAPL);
const page = path.join(here, 'src/.post-explainer.render.html');
writeFileSync(page, src);
const prefix = path.join(here, 'post-explainer');
execFileSync('node', [path.join(here, '../web/scripts/snapshot.mjs'), pathToFileURL(page).href, prefix, '1200', '1500', '0'], { env: { ...process.env, WAIT: '4500', SCALE: '2' }, stdio: 'ignore' });
renameSync(`${prefix}-0.png`, `${prefix}.png`);
console.log('post-explainer.png  2400x3000');

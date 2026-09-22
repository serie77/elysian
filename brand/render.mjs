/**
 * Renders the X profile picture, banners and post graphics from brand/src/*.html with headless Chrome, at 2x so
 * the edges stay crisp after X's own downscaling.
 *   node brand/render.mjs
 */
import { execFileSync } from 'node:child_process';
import { renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshot = path.join(here, '../web/scripts/snapshot.mjs');
for (const [page, out, w, h] of [['banner', 'x-banner', 1500, 500], ['banner-b', 'x-banner-alt', 1500, 500], ['pfp', 'x-profile', 800, 800], ['post-intro', 'post-intro', 1200, 675]]) {
  const prefix = path.join(here, out);
  execFileSync('node', [snapshot, pathToFileURL(path.join(here, 'src', `${page}.html`)).href, prefix, String(w), String(h), '0'], { env: { ...process.env, WAIT: '3500', SCALE: '2' }, stdio: 'ignore' });
  renameSync(`${prefix}-0.png`, `${prefix}.png`);
  console.log(`${out}.png  ${w * 2}x${h * 2}`);
}

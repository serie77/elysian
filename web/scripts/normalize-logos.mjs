/**
 * Makes the downloaded stock logos read as one set: trims transparent padding, picks a background the mark shows on
 * (white for dark marks, near-black for light ones), pads it, and writes a 96px opaque PNG in place.
 *   node web/scripts/normalize-logos.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/tokens/stocks');
const SIZE = 96;
const PAD = 14;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.png'))) {
  const path = resolve(dir, file);
  const trimmed = sharp(readFileSync(path)).trim({ threshold: 8 }).ensureAlpha();
  const { data, info } = await trimmed.raw().toBuffer({ resolveWithObject: true });
  // Mean luminance of the opaque pixels decides the background.
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
  }
  const light = n > 0 && sum / n > 150;
  const background = light ? { r: 20, g: 20, b: 22 } : { r: 255, g: 255, b: 255 };
  const inner = SIZE - PAD * 2;
  const mark = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const out = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { ...background, alpha: 1 } } })
    .composite([{ input: mark, gravity: 'centre' }])
    .flatten({ background })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(out).toFile(path);
}
console.log(`normalised ${readdirSync(dir).length} logos to ${SIZE}px`);

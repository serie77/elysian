/**
 * A lockfile written by npm on one OS can leave out the native builds for every other OS
 * (npm/cli#4828), and a Linux host such as Vercel then fails to find Next's compiler or Tailwind's
 * engine. This adds the missing optional platform packages to package-lock.json, exactly as npm
 * would have recorded them, without changing any resolved version.
 *
 *   node scripts/fix-lockfile-platforms.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../package-lock.json', import.meta.url);
const lock = JSON.parse(readFileSync(file, 'utf8'));
const pkgs = lock.packages;

/** Where npm would hoist `name` for a parent living at `parent`: beside an existing sibling, else the root. */
function placeFor(parent, siblings) {
  for (const sib of siblings) {
    let dir = parent;
    for (;;) {
      if (pkgs[`${dir}/node_modules/${sib}`]) return `${dir}/node_modules`;
      const up = dir.lastIndexOf('/node_modules/');
      if (up < 0) break;
      dir = dir.slice(0, up);
    }
    if (pkgs[`node_modules/${sib}`]) return 'node_modules';
  }
  return 'node_modules';
}

const wanted = new Map();
for (const [path, p] of Object.entries(pkgs)) {
  if (!path || !p.optionalDependencies) continue;
  const names = Object.keys(p.optionalDependencies);
  const present = names.filter((n) => Object.keys(pkgs).some((k) => k.endsWith(`node_modules/${n}`)));
  if (!present.length) continue; // a genuinely optional feature nobody installed, not a platform family
  const base = placeFor(path, present);
  for (const n of names) {
    const at = `${base}/${n}`;
    if (!pkgs[at] && /^\d/.test(p.optionalDependencies[n])) wanted.set(at, { name: n, version: p.optionalDependencies[n] });
  }
}

let added = 0;
const jobs = [...wanted];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let job = jobs.pop(); job; job = jobs.pop()) {
      const [at, { name, version }] = job;
      const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`);
      if (!res.ok) continue;
      const m = await res.json();
      pkgs[at] = {
        version,
        resolved: m.dist.tarball,
        integrity: m.dist.integrity,
        ...(m.cpu ? { cpu: m.cpu } : {}),
        ...(m.libc ? { libc: m.libc } : {}),
        ...(m.license ? { license: m.license } : {}),
        optional: true,
        ...(m.os ? { os: m.os } : {}),
        ...(m.engines ? { engines: m.engines } : {}),
      };
      added++;
    }
  }),
);

lock.packages = Object.fromEntries(Object.entries(pkgs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
console.log(`added ${added} platform packages`);

// Records the sha256 of every artifact a deployment depends on (circuit sources and keys, browser
// artifacts, verifier and contract sources) beside the deployment record, so a running deployment
// can always be matched to the exact files that produced it.
//   node scripts/release-manifest.mjs robinhood
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const name = process.argv[2] ?? 'robinhood';

const dirs = ['circuits/src', 'circuits/build/transaction', 'circuits/build/swapClaim', 'web/public/circuits', 'contracts/contracts'];
const skip = /\.(r1cs|sym|log)$|_js[\\/]generate_witness|witness_calculator/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (!skip.test(p)) yield p;
  }
}

const files = {};
for (const dir of dirs) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    files[path.relative(root, file).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
}

const deploymentFile = path.join(root, 'contracts/deployments', `${name}.json`);
const manifest = {
  createdAt: new Date().toISOString(),
  deployment: existsSync(deploymentFile) ? JSON.parse(readFileSync(deploymentFile, 'utf8')) : null,
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
};
const out = path.join(root, 'contracts/deployments', `${name}.manifest.json`);
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(files).length} files hashed → ${path.relative(root, out)}`);

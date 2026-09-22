/**
 * Compiles both circuits, runs the Groth16 setup against the Perpetual Powers of Tau, and emits
 * Solidity verifiers into contracts/contracts/verifiers plus browser artifacts into web/public.
 *
 *   node circuits/scripts/build.mjs [transaction|swapClaim]
 *
 * The phase-2 contribution here is a single development contribution: fine for a testnet, not
 * Keys are generated from fresh OS randomness that is discarded when this process exits.
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from 'snarkjs';

// New keys never match verifiers that are already deployed. Once mainnet is live, rebuilding would replace
// the only keys able to prove against it (web/public/circuits), locking every shielded balance.
if (existsSync(new URL('../../contracts/deployments/robinhood.json', import.meta.url)) && process.env.FORCE !== '1') {
  console.error('Refusing to rebuild: mainnet is deployed against the current keys. Set FORCE=1 only if you will redeploy the contracts too.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repo = resolve(root, '..');
const build = join(root, 'build');
const ptau = join(root, 'ptau', 'pot16.ptau');
const verifiersDir = join(repo, 'contracts', 'contracts', 'verifiers');
// Browser artifacts live under a versioned path, so a browser that cached an earlier release can never prove with the wrong keys.
const { PROTOCOL_VERSION } = await import(pathToFileURL(join(repo, 'packages', 'core', 'dist', 'constants.js')).href);
const webDir = join(repo, 'web', 'public', 'circuits', `v${PROTOCOL_VERSION}`);

const circuits = {
  transaction: { contract: 'TransactionVerifier' },
  swapClaim: { contract: 'SwapClaimVerifier' },
};

const only = process.argv[2];
mkdirSync(build, { recursive: true });
mkdirSync(verifiersDir, { recursive: true });
mkdirSync(webDir, { recursive: true });

if (!existsSync(ptau)) {
  console.error(`missing ${ptau}; download ppot_0080_16.ptau from the PSE Perpetual Powers of Tau`);
  process.exit(1);
}

for (const [name, cfg] of Object.entries(circuits)) {
  if (only && only !== name) continue;
  const t0 = Date.now();
  const outDir = join(build, name);
  mkdirSync(outDir, { recursive: true });
  console.log(`\n[${name}] compiling`);
  execSync(`circom "${join(root, 'src', `${name}.circom`)}" --r1cs --wasm --sym -o "${outDir}"`, { stdio: 'inherit' });

  const r1cs = join(outDir, `${name}.r1cs`);
  const info = await snarkjs.r1cs.info(r1cs);
  console.log(`[${name}] constraints: ${info.nConstraints}, public inputs: ${info.nPubInputs}`);

  const zkey0 = join(outDir, `${name}_0000.zkey`);
  const zkey = join(outDir, `${name}.zkey`);
  console.log(`[${name}] groth16 setup`);
  await snarkjs.zKey.newZKey(r1cs, ptau, zkey0);
  // Two contributions and a beacon, each from fresh OS randomness that exists only in this process
  // and is never written anywhere. Forging a proof needs every one of these secrets; nobody has any.
  const zkey1 = join(outDir, `${name}_0001.zkey`);
  const zkey2 = join(outDir, `${name}_0002.zkey`);
  await snarkjs.zKey.contribute(zkey0, zkey1, 'elysian 1', randomBytes(64).toString('hex'));
  await snarkjs.zKey.contribute(zkey1, zkey2, 'elysian 2', randomBytes(64).toString('hex'));
  await snarkjs.zKey.beacon(zkey2, zkey, 'elysian beacon', randomBytes(32).toString('hex'), 10);
  for (const f of [zkey0, zkey1, zkey2]) rmSync(f, { force: true });
  const vkey = await snarkjs.zKey.exportVerificationKey(zkey);
  writeFileSync(join(outDir, `${name}.vkey.json`), JSON.stringify(vkey, null, 2));

  const template = readFileSync(join(repo, 'node_modules', 'snarkjs', 'templates', 'verifier_groth16.sol.ejs'), 'utf8');
  const solidity = await snarkjs.zKey.exportSolidityVerifier(zkey, { groth16: template });
  const renamed = solidity
    .replace(/contract Groth16Verifier/g, `contract ${cfg.contract}`)
    .replace(/pragma solidity [^;]+;/, 'pragma solidity ^0.8.20;');
  writeFileSync(join(verifiersDir, `${cfg.contract}.sol`), renamed);

  copyFileSync(join(outDir, `${name}_js`, `${name}.wasm`), join(webDir, `${name}.wasm`));
  copyFileSync(zkey, join(webDir, `${name}.zkey`));
  copyFileSync(join(outDir, `${name}.vkey.json`), join(webDir, `${name}.vkey.json`));
  console.log(`[${name}] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
process.exit(0);

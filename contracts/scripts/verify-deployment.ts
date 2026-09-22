/**
 * Confirms a recorded deployment is the reviewed release: every contract's bytecode equals the compiled artifact
 * (immutable slots masked), every immutable and setting reads back as recorded (verifier, hasher, tree depth,
 * adapter registration, venue, batch length, executor, owner), the Poseidon hasher answers like the circuits'
 * Poseidon, and an empty tree's root equals the client mirror's.
 *   DEPLOYMENT=robinhood npx hardhat run scripts/verify-deployment.ts --network robinhood
 */
import fs from 'node:fs';
import path from 'node:path';
import { artifacts, ethers, network } from 'hardhat';
import { MerkleTree, poseidon2, toHex32 } from '@elysian/core';

const ABI = [
  'function verifier() view returns (address)',
  'function hasher() view returns (address)',
  'function levels() view returns (uint32)',
  'function owner() view returns (address)',
  'function adapters(address) view returns (bool)',
  'function pool() view returns (address)',
  'function dex() view returns (address)',
  'function batchDuration() view returns (uint256)',
  'function executors(address) view returns (bool)',
  'function nextIndex() view returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function hashLeftRight(address hasher, bytes32 left, bytes32 right) pure returns (bytes32)',
];

let failed = false;
const check = (label: string, ok: boolean, detail = '') => {
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function main() {
  const name = process.env.DEPLOYMENT ?? network.name;
  const dep = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../deployments', `${name}.json`), 'utf8'));
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (BigInt(dep.chainId) !== chainId) throw new Error(`deployment ${name} is for chain ${dep.chainId}, connected to ${chainId}`);
  console.log(`deployment ${name} on chain ${chainId}`);

  // 1. Bytecode, immutables masked.
  const contracts: [string, string][] = [
    ['TransactionVerifier', dep.transactionVerifier],
    ['SwapClaimVerifier', dep.swapClaimVerifier],
    ['ElysianPool', dep.pool],
    ['ElysianSwap', dep.swap],
    [chainId === 31337n ? 'MockDex' : 'UniswapV3Adapter', dep.dex],
  ];
  for (const [contract, address] of contracts) {
    const artifact = await artifacts.readArtifact(contract);
    const info = await artifacts.getBuildInfo(`${artifact.sourceName}:${contract}`);
    const compiled = info!.output.contracts[artifact.sourceName][contract].evm.deployedBytecode;
    const expected = Buffer.from(compiled.object, 'hex');
    const actual = Buffer.from((await ethers.provider.getCode(address)).slice(2), 'hex');
    for (const refs of Object.values(compiled.immutableReferences ?? {})) {
      for (const { start, length } of refs as { start: number; length: number }[]) {
        expected.fill(0, start, start + length);
        if (actual.length >= start + length) actual.fill(0, start, start + length);
      }
    }
    check(`bytecode ${contract.padEnd(19)} ${address}`, expected.equals(actual), `${actual.length} bytes`);
  }

  // 2. Wiring: every immutable and setting the masked comparison skipped.
  const pool = new ethers.Contract(dep.pool, ABI, ethers.provider);
  const swap = new ethers.Contract(dep.swap, ABI, ethers.provider);
  check('pool.verifier == transactionVerifier', same(await pool.verifier(), dep.transactionVerifier));
  check('pool.hasher == hasher', same(await pool.hasher(), dep.hasher));
  check('pool.levels == levels', Number(await pool.levels()) === dep.levels);
  check('pool.adapters(swap) == true', await pool.adapters(dep.swap));
  check('swap.pool == pool', same(await swap.pool(), dep.pool));
  check('swap.verifier == swapClaimVerifier', same(await swap.verifier(), dep.swapClaimVerifier));
  check('swap.hasher == hasher', same(await swap.hasher(), dep.hasher));
  check('swap.levels == levels', Number(await swap.levels()) === dep.levels);
  check('swap.dex == dex', same(await swap.dex(), dep.dex));
  check('swap.batchDuration == batchDuration', Number(await swap.batchDuration()) === dep.batchDuration);
  const owner = await pool.owner();
  check('pool.owner == swap.owner', same(owner, await swap.owner()), owner);
  if (dep.owner) check('owner == recorded owner', same(owner, dep.owner));
  if (dep.executor) check('swap.executors(executor) == true', await swap.executors(dep.executor), dep.executor);

  // 3. The hasher: no Solidity artifact, so check what it computes against the circuits' Poseidon.
  check('hasher has code', (await ethers.provider.getCode(dep.hasher)).length > 2);
  for (const [a, b] of [
    [1n, 2n],
    [3n, 4n],
    [12345678901234567890n, 98765432109876543210n],
  ]) {
    const onchain = await pool.hashLeftRight(dep.hasher, toHex32(a), toHex32(b));
    check(`hasher poseidon(${a}, ${b}) matches the circuits`, same(onchain, toHex32(poseidon2([a, b]))));
  }
  // An untouched tree's root ties the hasher, the zero leaf and the depth together.
  const empty = toHex32(new MerkleTree(dep.levels).root);
  for (const [label, c] of [
    ['pool', pool],
    ['swap', swap],
  ] as const) {
    if (Number(await c.nextIndex()) === 0) check(`${label} empty root == client mirror`, same(await c.getLastRoot(), empty));
    else console.log(`skip ${label} tree already has leaves; root not compared`);
  }

  if (failed) throw new Error('deployment does not match the reviewed release');
  console.log('deployment verified');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

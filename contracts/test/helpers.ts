import { ethers } from 'hardhat';
import type { Signer, Contract } from 'ethers';
import path from 'node:path';
import fs from 'node:fs';
import type * as Core from '@elysian/core';

export type CoreModule = typeof Core;

export async function loadCore(): Promise<CoreModule> {
  return (await import('@elysian/core')) as CoreModule;
}

/** Deploys the circomlibjs Poseidon(2) hasher used by both trees. */
export async function deployHasher(signer: Signer): Promise<Contract> {
  const { poseidonContract } = await import('circomlibjs');
  const abi = poseidonContract.generateABI(2);
  const bytecode = poseidonContract.createCode(2);
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const hasher = await factory.deploy();
  await hasher.waitForDeployment();
  return hasher as unknown as Contract;
}

const circuitsBuild = path.resolve(__dirname, '../../circuits/build');

export function artifactsAvailable(name: 'transaction' | 'swapClaim'): boolean {
  return fs.existsSync(path.join(circuitsBuild, name, `${name}.zkey`));
}

export async function prove(name: 'transaction' | 'swapClaim', inputs: Record<string, unknown>) {
  const snarkjs = await import('snarkjs');
  const wasm = path.join(circuitsBuild, name, `${name}_js`, `${name}.wasm`);
  const zkey = path.join(circuitsBuild, name, `${name}.zkey`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasm, zkey);
  return { proof, publicSignals: publicSignals as string[] };
}

/** The (chainId, contract) pair every hash is bound to. */
export async function domainOf(contract: Contract): Promise<{ chainId: bigint; contract: `0x${string}` }> {
  const { chainId } = await ethers.provider.getNetwork();
  return { chainId, contract: (await contract.getAddress()) as `0x${string}` };
}

export const hex = (b: Uint8Array): string => '0x' + Buffer.from(b).toString('hex');
export const unhex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h.slice(2), 'hex'));

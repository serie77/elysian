/**
 * What a mainnet deployment would cost, without spending anything. Deploys the whole stack on a
 * fork of Robinhood Chain to count execution gas, then asks the live chain to price the three
 * dependency-free deployments (which includes the fee for posting their bytes to Ethereum) and
 * scales the rest by the same ratio.
 *
 *   FORK=1 npx hardhat run scripts/estimate-deploy.ts
 */
import { config, ethers } from 'hardhat';
import { UNISWAP } from './uniswap';

const LEVELS = 20;

async function main() {
  const live = new ethers.JsonRpcProvider(config.networks.hardhat.forking!.url);
  const [deployer] = await ethers.getSigners();
  const owner = await deployer.getAddress();
  const { poseidonContract } = await import('circomlibjs');

  const steps: { name: string; gas: bigint; bytes: number; liveGas?: bigint }[] = [];
  const track = async (name: string, tx: { hash: string; data: string } | null, standalone = false) => {
    const receipt = await ethers.provider.getTransactionReceipt(tx!.hash);
    const step: (typeof steps)[number] = { name, gas: receipt!.gasUsed, bytes: (tx!.data.length - 2) / 2 };
    if (standalone) step.liveGas = await live.estimateGas({ data: tx!.data });
    steps.push(step);
  };

  const hasher = await new ethers.ContractFactory(poseidonContract.generateABI(2), poseidonContract.createCode(2), deployer).deploy();
  await hasher.waitForDeployment();
  await track('Poseidon hasher', hasher.deploymentTransaction(), true);
  const txVerifier = await (await ethers.getContractFactory('TransactionVerifier')).deploy();
  await txVerifier.waitForDeployment();
  await track('Transaction verifier', txVerifier.deploymentTransaction(), true);
  const claimVerifier = await (await ethers.getContractFactory('SwapClaimVerifier')).deploy();
  await claimVerifier.waitForDeployment();
  await track('Claim verifier', claimVerifier.deploymentTransaction(), true);
  const pool = await (await ethers.getContractFactory('ElysianPool')).deploy(await txVerifier.getAddress(), await hasher.getAddress(), LEVELS, owner);
  await pool.waitForDeployment();
  await track('ElysianPool', pool.deploymentTransaction());
  const adapter = await (await ethers.getContractFactory('UniswapV3Adapter')).deploy(UNISWAP.router, UNISWAP.quoter, UNISWAP.factory, UNISWAP.weth);
  await adapter.waitForDeployment();
  await track('Uniswap adapter', adapter.deploymentTransaction());
  const swap = await (await ethers.getContractFactory('ElysianSwap')).deploy(await pool.getAddress(), await claimVerifier.getAddress(), await hasher.getAddress(), LEVELS, 60, await adapter.getAddress(), owner);
  await swap.waitForDeployment();
  await track('ElysianSwap', swap.deploymentTransaction());
  const a = await (pool as any).setAdapter(await swap.getAddress(), true);
  await a.wait();
  await track('Register swap on pool', a);
  const e = await (swap as any).setExecutor(owner, true);
  await e.wait();
  await track('Register executor', e);

  // Live gas is higher than fork gas by the cost of posting the transaction's bytes to Ethereum.
  const priced = steps.filter((s) => s.liveGas);
  const perByte = Number(priced.reduce((t, s) => t + (s.liveGas! - s.gas), 0n)) / priced.reduce((t, s) => t + s.bytes, 0);
  const gasPrice = (await live.getFeeData()).gasPrice!;
  let total = 0n;
  console.log(`gas price ${ethers.formatUnits(gasPrice, 'gwei')} gwei, data surcharge about ${perByte.toFixed(1)} gas per byte`);
  for (const s of steps) {
    const gas = s.liveGas ?? s.gas + BigInt(Math.round(perByte * s.bytes));
    total += gas;
    console.log(`${s.name.padEnd(24)} ${gas.toString().padStart(10)} gas  ${ethers.formatEther(gas * gasPrice)} ETH${s.liveGas ? '  (priced by the live chain)' : ''}`);
  }
  console.log(`${'TOTAL'.padEnd(24)} ${total.toString().padStart(10)} gas  ${ethers.formatEther(total * gasPrice)} ETH`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

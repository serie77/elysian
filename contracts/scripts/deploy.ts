/**
 * Deploys the Elysian stack.
 *
 *   npx hardhat run scripts/deploy.ts --network robinhoodTestnet
 *
 * Env:
 *   DEPLOYER_KEY      signer
 *   BATCH_DURATION    seconds per swap batch (default 60)
 *   EXECUTOR          address allowed to clear batches (defaults to deployer)
 *   SEED_DEMO=1       on local networks, deploy mock NVDA/USDG and seed the mock venue
 */
import { ethers, network } from 'hardhat';
import fs from 'node:fs';
import path from 'node:path';
import { PROTOCOL_VERSION } from '@elysian/core';
import { UNISWAP } from './uniswap';

const LEVELS = 20;

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = await deployer.getAddress();
  const batchDuration = BigInt(process.env.BATCH_DURATION ?? '60');
  const executor = process.env.EXECUTOR ?? owner;
  console.log(`network ${network.name}, deployer ${owner}`);

  const { poseidonContract } = await import('circomlibjs');
  const hasherFactory = new ethers.ContractFactory(poseidonContract.generateABI(2), poseidonContract.createCode(2), deployer);
  const hasher = await hasherFactory.deploy();
  await hasher.waitForDeployment();
  console.log(`hasher            ${await hasher.getAddress()}`);

  const txVerifier = await (await ethers.getContractFactory('TransactionVerifier')).deploy();
  await txVerifier.waitForDeployment();
  const claimVerifier = await (await ethers.getContractFactory('SwapClaimVerifier')).deploy();
  await claimVerifier.waitForDeployment();
  console.log(`tx verifier       ${await txVerifier.getAddress()}`);
  console.log(`claim verifier    ${await claimVerifier.getAddress()}`);

  const pool = await (await ethers.getContractFactory('ElysianPool')).deploy(
    await txVerifier.getAddress(),
    await hasher.getAddress(),
    LEVELS,
    owner,
  );
  await pool.waitForDeployment();
  console.log(`pool              ${await pool.getAddress()}`);

  let dexAddress: string;
  // Real liquidity only exists on mainnet; every other network gets a MockDex (dev only).
  if (network.name === 'robinhood') {
    const adapter = await (await ethers.getContractFactory('UniswapV3Adapter')).deploy(UNISWAP.router, UNISWAP.quoter, UNISWAP.factory, UNISWAP.weth);
    await adapter.waitForDeployment();
    dexAddress = await adapter.getAddress();
    console.log(`uniswap adapter   ${dexAddress}`);
  } else {
    const dex = await (await ethers.getContractFactory('MockDex')).deploy();
    await dex.waitForDeployment();
    dexAddress = await dex.getAddress();
    console.log(`mock venue        ${dexAddress}`);
  }

  const swap = await (await ethers.getContractFactory('ElysianSwap')).deploy(
    await pool.getAddress(),
    await claimVerifier.getAddress(),
    await hasher.getAddress(),
    LEVELS,
    batchDuration,
    dexAddress,
    owner,
  );
  await swap.waitForDeployment();
  console.log(`swap              ${await swap.getAddress()}`);

  await (await pool.setAdapter(await swap.getAddress(), true)).wait();
  await (await swap.setExecutor(executor, true)).wait();

  const deployment: Record<string, unknown> = {
    network: network.name,
    version: PROTOCOL_VERSION,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    startBlock: await ethers.provider.getBlockNumber(),
    hasher: await hasher.getAddress(),
    transactionVerifier: await txVerifier.getAddress(),
    swapClaimVerifier: await claimVerifier.getAddress(),
    pool: await pool.getAddress(),
    swap: await swap.getAddress(),
    dex: dexAddress,
    batchDuration: Number(batchDuration),
    levels: LEVELS,
    owner,
    executor,
  };

  if (process.env.SEED_DEMO === '1') {
    const Token = await ethers.getContractFactory('MockERC20');
    const nvda = await Token.deploy('NVIDIA Robinhood Token', 'NVDA');
    const usdg = await Token.deploy('Global Dollar', 'USDG');
    const tsla = await Token.deploy('Tesla Robinhood Token', 'TSLA');
    const weth = await (await ethers.getContractFactory('MockWETH')).deploy();
    await Promise.all([nvda.waitForDeployment(), usdg.waitForDeployment(), tsla.waitForDeployment(), weth.waitForDeployment()]);
    const E18 = 10n ** 18n;
    await (await nvda.mint(owner, 10_000n * E18)).wait();
    await (await tsla.mint(owner, 10_000n * E18)).wait();
    await (await usdg.mint(owner, 1_000_000n * E18)).wait();
    await (await nvda.mint(dexAddress, 100_000n * E18)).wait();
    await (await tsla.mint(dexAddress, 100_000n * E18)).wait();
    await (await usdg.mint(dexAddress, 40_000_000n * E18)).wait();
    await (await weth.deposit({ value: 500n * E18 })).wait();
    await (await weth.transfer(dexAddress, 500n * E18)).wait();
    deployment.tokens = {
      NVDA: await nvda.getAddress(),
      TSLA: await tsla.getAddress(),
      USDG: await usdg.getAddress(),
      WETH: await weth.getAddress(),
    };
    console.log(`demo tokens       ${JSON.stringify(deployment.tokens)}`);
  }

  const outDir = path.resolve(__dirname, '../deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
  console.log(`wrote ${file}`);

  // Keep the web app's registry in sync.
  const webFile = path.resolve(__dirname, '../../web/src/lib/deployments.json');
  let registry: Record<string, unknown> = {};
  if (fs.existsSync(webFile)) registry = JSON.parse(fs.readFileSync(webFile, 'utf8'));
  registry[String(deployment.chainId)] = deployment;
  fs.mkdirSync(path.dirname(webFile), { recursive: true });
  fs.writeFileSync(webFile, JSON.stringify(registry, null, 2));
  console.log(`updated ${webFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

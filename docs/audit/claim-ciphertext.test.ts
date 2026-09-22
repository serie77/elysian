// Audit reproduction, isolated Hardhat network only; never use --network on a live chain.
// cd contracts && npx hardhat test ../docs/audit/claim-ciphertext.test.ts
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { deployHasher, hex, loadCore, prove, unhex } from '../../contracts/test/helpers';

describe('Audit: swap claim ciphertext binding', function () {
  it('rejects a copied proof with a replaced ciphertext (the original P1-04 reproduction, now expected to fail)', async function () {
    if (network.name !== 'hardhat') throw new Error('Audit test requires isolated hardhat network');
    const core = await loadCore();
    const [admin, alice, attacker] = await ethers.getSigners();
    const hasher = await deployHasher(admin);
    const verifier = await (await ethers.getContractFactory('TransactionVerifier')).deploy();
    const claimVerifier = await (await ethers.getContractFactory('SwapClaimVerifier')).deploy();
    const pool: any = await (await ethers.getContractFactory('ElysianPool')).deploy(await verifier.getAddress(), await hasher.getAddress(), 20, admin.address);
    const dex = await (await ethers.getContractFactory('MockDex')).deploy();
    const swap: any = await (await ethers.getContractFactory('ElysianSwap')).deploy(await pool.getAddress(), await claimVerifier.getAddress(), await hasher.getAddress(), 20, 60, await dex.getAddress(), admin.address);
    await pool.setAdapter(await swap.getAddress(), true);
    await swap.setExecutor(admin.address, true);
    const token: any = await (await ethers.getContractFactory('MockERC20')).deploy('Audit input', 'IN');
    const out: any = await (await ethers.getContractFactory('MockERC20')).deploy('Audit output', 'OUT');
    const asset = await token.getAddress();
    const assetOut = await out.getAddress();
    const poolAddress = await pool.getAddress();
    await token.mint(alice.address, 1000n);
    await token.mint(await dex.getAddress(), 1000000n);
    await out.mint(await dex.getAddress(), 1000000n);
    await token.connect(alice).approve(poolAddress, 1000n);
    const key = core.SpendingKey.random();
    const tree = new core.MerkleTree(20);
    const records: any[] = [];
    async function sync() {
      for (const ev of await pool.queryFilter(pool.filters.NewCommitment())) {
        const [commitment, index, ciphertext] = ev.args;
        if (Number(index) < tree.size) continue;
        tree.insert(BigInt(commitment));
        records.push({ commitment: BigInt(commitment), index: Number(index), ciphertext: unhex(ciphertext) });
      }
    }
    async function transact(inputs: any[], outputs: any[], extAmount: bigint, recipient = core.ZERO_ADDRESS, adapterData = new Uint8Array()) {
      while (outputs.length < 2) outputs.push(core.dummyNote(BigInt(asset), key.pk));
      const ext = { recipient, extAmount, relayer: core.ZERO_ADDRESS, fee: 0n, encryptedOutput1: core.encryptTo(key.encPub, core.serializeNote(outputs[0])), encryptedOutput2: core.encryptTo(key.encPub, core.serializeNote(outputs[1])), adapterData };
      const extHash = core.extDataHash(ext, { chainId: 31337, contract: poolAddress as `0x${string}` });
      const publicAmount = core.publicAmount(extAmount, 0n);
      const w = core.buildTransactionWitness({ key, tree, assetId: BigInt(asset), inputs: inputs.map(note => ({ note, leafIndex: note.leafIndex, path: tree.path(note.leafIndex) })), outputs, publicAmount, extDataHash: extHash });
      const { proof } = await prove('transaction', w.circuitInputs);
      await pool.connect(alice).transact({ proof: core.encodeProof(proof), root: core.toHex32(w.root), inputNullifiers: w.inputNullifiers.map(core.toHex32), outputCommitments: w.outputCommitments.map(core.toHex32), publicAmount, assetId: BigInt(asset), extDataHash: core.toHex32(extHash) }, { ...ext, encryptedOutput1: hex(ext.encryptedOutput1), encryptedOutput2: hex(ext.encryptedOutput2), adapterData: hex(adapterData) });
      await sync();
    }
    await transact([], [core.createNote(asset, 1000n, key.pk)], 1000n);
    const input = core.scanCommitments(key, records).find(n => n.amount === 1000n)!;
    const batchId = await swap.currentBatch();
    const intent = { batchId, assetIn: BigInt(asset), assetOut: BigInt(assetOut), amountIn: 1000n, pk: key.pk, blinding: core.randomField() };
    const adapterData = core.encodeSwapAdapterData(assetOut, core.swapOwnerTag(intent), batchId, core.encryptTo(key.encPub, core.serializeSwap(intent)));
    await transact([input], [], -1000n, await swap.getAddress(), adapterData);
    await network.provider.send('evm_setNextBlockTimestamp', [Number((batchId + 1n) * 60n + 1n)]);
    await swap.executeBatch(asset, assetOut, batchId, 0n);
    const batch = await swap.getBatch(asset, assetOut, batchId);
    const swapTree = new core.MerkleTree(20);
    swapTree.insert(core.swapCommitment(intent));
    const w = core.buildSwapClaimWitness({ key, domain: { chainId: 31337, contract: (await swap.getAddress()) as `0x${string}` }, encPub: key.encPub, swap: intent, path: swapTree.path(0), totalIn: batch.totalIn, totalOut: batch.totalOut, outBlinding: core.randomField() });
    const { proof } = await prove('swapClaim', w.circuitInputs);
    const legitimate = { proof: core.encodeProof(proof), swapRoot: core.toHex32(w.swapRoot), batchId, assetIn: asset, assetOut, nullifier: core.toHex32(w.nullifier), outputCommitment: core.toHex32(w.outputCommitment), encryptedOutput: hex(w.encryptedOutput) };
    await expect(swap.connect(attacker).claim({ ...legitimate, encryptedOutput: '0x' })).to.be.revertedWithCustomError(swap, 'InvalidClaimProof');
    await expect(swap.connect(alice).claim(legitimate)).to.emit(swap, 'SwapClaimed');
    await sync();
    expect(core.scanCommitments(key, records).some(n => n.commitment === w.outputCommitment)).to.equal(true);
    // The ciphertext is a public input of the proof, so only the owner's bytes can ride this claim.
  });
});

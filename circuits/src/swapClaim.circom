pragma circom 2.2.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "./merkleProof.circom";
include "./keypair.circom";

// Claims the output of a sealed batch swap.
//
//   swapCommitment = Poseidon(4, batchId, assetIn, assetOut, amountIn, pk, blinding)
//   swapNullifier  = Poseidon(5, nk, swapCommitment)
//   amountOut      = floor(amountIn * totalOut / totalIn)
//   output note    = Poseidon(amountOut, assetOut, pk, outBlinding)
//
// totalIn / totalOut are the batch's cleared volumes, published by ElysianSwap.
template SwapClaim(levels, amountBits) {
    // public
    // Hash of (chain id, swap contract, encrypted output): bound so a relayer cannot replace the ciphertext.
    signal input claimDataHash;
    signal input swapRoot;
    signal input batchId;
    signal input assetIn;
    signal input assetOut;
    // What the claim is paid in: assetOut for a cleared batch, assetIn for a cancelled one (the contract decides).
    signal input payoutAsset;
    signal input totalIn;
    signal input totalOut;
    signal input swapNullifier;
    signal input outputCommitment;

    // private
    signal input sk;
    signal input amountIn;
    signal input blinding;
    signal input pathIndices;
    signal input pathElements[levels];
    signal input amountOut;
    signal input remainder;
    signal input outBlinding;

    component keys = Keypair();
    keys.sk <== sk;

    // The owner tag is all the user supplies. The contract folds the amount it actually received, the
    // batch and the pair into the leaf itself, so an order can never claim to be bigger than it was.
    component tag = Poseidon(3);
    tag.inputs[0] <== 4;
    tag.inputs[1] <== keys.pk;
    tag.inputs[2] <== blinding;
    component fold[4];
    for (var f = 0; f < 4; f++) {
        fold[f] = Poseidon(2);
    }
    fold[0].inputs[0] <== tag.out;
    fold[0].inputs[1] <== amountIn;
    fold[1].inputs[0] <== fold[0].out;
    fold[1].inputs[1] <== batchId;
    fold[2].inputs[0] <== fold[1].out;
    fold[2].inputs[1] <== assetIn;
    fold[3].inputs[0] <== fold[2].out;
    fold[3].inputs[1] <== assetOut;
    component tree = MerkleProof(levels);
    tree.leaf <== fold[3].out;
    tree.pathIndices <== pathIndices;
    for (var j = 0; j < levels; j++) {
        tree.pathElements[j] <== pathElements[j];
    }
    tree.root === swapRoot;

    component nullifier = Poseidon(3);
    nullifier.inputs[0] <== 5;
    nullifier.inputs[1] <== keys.nk;
    nullifier.inputs[2] <== fold[3].out;
    nullifier.out === swapNullifier;

    // Range-check every operand so the products below cannot wrap the field.
    component rAmountIn = Num2Bits(amountBits);
    rAmountIn.in <== amountIn;
    component rTotalIn = Num2Bits(amountBits);
    rTotalIn.in <== totalIn;
    component rTotalOut = Num2Bits(amountBits);
    rTotalOut.in <== totalOut;
    component rAmountOut = Num2Bits(amountBits);
    rAmountOut.in <== amountOut;
    component rRemainder = Num2Bits(amountBits);
    rRemainder.in <== remainder;

    // amountIn * totalOut == amountOut * totalIn + remainder, with remainder < totalIn.
    signal lhs;
    lhs <== amountIn * totalOut;
    signal rhs;
    rhs <== amountOut * totalIn;
    lhs === rhs + remainder;

    component lt = LessThan(amountBits);
    lt.in[0] <== remainder;
    lt.in[1] <== totalIn;
    lt.out === 1;

    component out = Poseidon(4);
    out.inputs[0] <== amountOut;
    out.inputs[1] <== payoutAsset;
    out.inputs[2] <== keys.pk;
    out.inputs[3] <== outBlinding;
    out.out === outputCommitment;

    // Keep the binding in the constraint system (an unused public input would be dropped by the compiler).
    signal claimDataSquare;
    claimDataSquare <== claimDataHash * claimDataHash;
}

component main { public [claimDataHash, swapRoot, batchId, assetIn, assetOut, payoutAsset, totalIn, totalOut, swapNullifier, outputCommitment] } = SwapClaim(20, 120);

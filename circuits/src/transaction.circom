pragma circom 2.2.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "./merkleProof.circom";
include "./keypair.circom";

// A shielded transaction: spend up to nIns notes, create nOuts notes, and move publicAmount
// of value across the shield boundary. All notes in one transaction share a single asset.
//
//   commitment = Poseidon(amount, asset, pk, blinding)
//   nullifier  = Poseidon(3, nk, commitment, leafIndex)
//   sum(in) + publicAmount == sum(out)   (mod p; negative publicAmount unshields)
//
// Zero-amount inputs are dummies and skip the membership check, which is what lets a
// single-input spend still produce a fixed-shape proof.
template Transaction(levels, nIns, nOuts, amountBits) {
    // public
    signal input root;
    signal input publicAmount;
    signal input extDataHash;
    signal input assetId;
    signal input inputNullifier[nIns];
    signal input outputCommitment[nOuts];

    // private
    signal input sk;
    signal input inAmount[nIns];
    signal input inBlinding[nIns];
    signal input inPathIndices[nIns];
    signal input inPathElements[nIns][levels];
    signal input outAmount[nOuts];
    signal input outPk[nOuts];
    signal input outBlinding[nOuts];

    component keys = Keypair();
    keys.sk <== sk;

    component inCommitment[nIns];
    component inNullifier[nIns];
    component inTree[nIns];
    component inCheckRoot[nIns];
    component inRange[nIns];
    var sumIns = 0;

    for (var i = 0; i < nIns; i++) {
        inCommitment[i] = Poseidon(4);
        inCommitment[i].inputs[0] <== inAmount[i];
        inCommitment[i].inputs[1] <== assetId;
        inCommitment[i].inputs[2] <== keys.pk;
        inCommitment[i].inputs[3] <== inBlinding[i];

        inNullifier[i] = Poseidon(4);
        inNullifier[i].inputs[0] <== 3;
        inNullifier[i].inputs[1] <== keys.nk;
        inNullifier[i].inputs[2] <== inCommitment[i].out;
        inNullifier[i].inputs[3] <== inPathIndices[i];
        inNullifier[i].out === inputNullifier[i];

        inTree[i] = MerkleProof(levels);
        inTree[i].leaf <== inCommitment[i].out;
        inTree[i].pathIndices <== inPathIndices[i];
        for (var j = 0; j < levels; j++) {
            inTree[i].pathElements[j] <== inPathElements[i][j];
        }

        // Only real notes must be in the tree.
        inCheckRoot[i] = ForceEqualIfEnabled();
        inCheckRoot[i].in[0] <== root;
        inCheckRoot[i].in[1] <== inTree[i].root;
        inCheckRoot[i].enabled <== inAmount[i];

        inRange[i] = Num2Bits(amountBits);
        inRange[i].in <== inAmount[i];

        sumIns += inAmount[i];
    }

    component outCommitment[nOuts];
    component outRange[nOuts];
    var sumOuts = 0;

    for (var i = 0; i < nOuts; i++) {
        outCommitment[i] = Poseidon(4);
        outCommitment[i].inputs[0] <== outAmount[i];
        outCommitment[i].inputs[1] <== assetId;
        outCommitment[i].inputs[2] <== outPk[i];
        outCommitment[i].inputs[3] <== outBlinding[i];
        outCommitment[i].out === outputCommitment[i];

        outRange[i] = Num2Bits(amountBits);
        outRange[i].in <== outAmount[i];

        sumOuts += outAmount[i];
    }

    // No two inputs may share a nullifier.
    component sameNullifiers[nIns * (nIns - 1) / 2];
    var index = 0;
    for (var i = 0; i < nIns - 1; i++) {
        for (var j = i + 1; j < nIns; j++) {
            sameNullifiers[index] = IsEqual();
            sameNullifiers[index].in[0] <== inputNullifier[i];
            sameNullifiers[index].in[1] <== inputNullifier[j];
            sameNullifiers[index].out === 0;
            index++;
        }
    }

    sumIns + publicAmount === sumOuts;

    // Bind extDataHash so the optimiser cannot drop it.
    signal extDataSquare;
    extDataSquare <== extDataHash * extDataHash;
}

component main { public [root, publicAmount, extDataHash, assetId, inputNullifier, outputCommitment] } = Transaction(20, 2, 2, 120);

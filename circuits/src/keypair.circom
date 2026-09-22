pragma circom 2.2.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";

// Derives the public halves of a Elysian key from the spending key.
//   ak = Poseidon(1, sk)   spend authority
//   nk = Poseidon(2, sk)   nullifier key
//   pk = Poseidon(ak, nk)  note owner
template Keypair() {
    signal input sk;
    signal output ak;
    signal output nk;
    signal output pk;

    component hAk = Poseidon(2);
    hAk.inputs[0] <== 1;
    hAk.inputs[1] <== sk;
    ak <== hAk.out;

    component hNk = Poseidon(2);
    hNk.inputs[0] <== 2;
    hNk.inputs[1] <== sk;
    nk <== hNk.out;

    component hPk = Poseidon(2);
    hPk.inputs[0] <== ak;
    hPk.inputs[1] <== nk;
    pk <== hPk.out;
}

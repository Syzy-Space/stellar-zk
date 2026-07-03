pragma circom 2.1.9;
include "../../node_modules/circomlib/circuits/poseidon.circom";

// nullifier = Poseidon(ownerSk, rho, leafIndex); ownerPk = Poseidon(ownerSk)
template Nullifier() {
    signal input ownerSk;
    signal input rho;
    signal input leafIndex;
    signal output nullifier;
    signal output ownerPk;

    component pk = Poseidon(1);
    pk.inputs[0] <== ownerSk;
    ownerPk <== pk.out;

    component nf = Poseidon(3);
    nf.inputs[0] <== ownerSk;
    nf.inputs[1] <== rho;
    nf.inputs[2] <== leafIndex;
    nullifier <== nf.out;
}

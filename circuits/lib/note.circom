pragma circom 2.1.9;

include "../../node_modules/circomlib/circuits/poseidon.circom";

// commitment = Poseidon(asset, amount, ownerPk, rho)
template NoteCommitment() {
    signal input asset;    // 0=COLLATERAL, 1=YES, 2=NO
    signal input amount;
    signal input ownerPk;
    signal input rho;
    signal output commitment;

    component h = Poseidon(4);
    h.inputs[0] <== asset;
    h.inputs[1] <== amount;
    h.inputs[2] <== ownerPk;
    h.inputs[3] <== rho;
    commitment <== h.out;
}

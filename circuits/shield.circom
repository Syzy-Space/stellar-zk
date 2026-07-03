pragma circom 2.1.9;
include "lib/note.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Public: amount, commitment. Private: ownerPk, rho. asset fixed to COLLATERAL(0).
template Shield() {
    signal input amount;      // public
    signal input commitment;  // public
    signal input ownerPk;     // private
    signal input rho;         // private

    // range: amount < 2^64
    component lt = LessThan(252);
    lt.in[0] <== amount;
    lt.in[1] <== 18446744073709551616; // 2^64
    lt.out === 1;

    component note = NoteCommitment();
    note.asset <== 0;
    note.amount <== amount;
    note.ownerPk <== ownerPk;
    note.rho <== rho;
    commitment === note.commitment;
}

component main {public [amount, commitment]} = Shield();

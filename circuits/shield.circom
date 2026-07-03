pragma circom 2.1.9;
include "lib/note.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Public: amount, commitment. Private: ownerPk, rho. asset fixed to COLLATERAL(0).
template Shield() {
    signal input amount;      // public
    signal input commitment;  // public
    signal input ownerPk;     // private
    signal input rho;         // private

    // range: amount in [0, 2^64). Num2Bits(64) is self-contained and avoids the
    // operand-range assumption baked into LessThan.
    component rc = Num2Bits(64);
    rc.in <== amount;

    component note = NoteCommitment();
    note.asset <== 0;
    note.amount <== amount;
    note.ownerPk <== ownerPk;
    note.rho <== rho;
    commitment === note.commitment;
}

component main {public [amount, commitment]} = Shield();

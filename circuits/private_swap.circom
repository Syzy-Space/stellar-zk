pragma circom 2.1.9;
include "lib/note.circom";
include "lib/nullifier.circom";
include "lib/merkle.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Public: root, nullifierIn, outCommitment, changeCommitment,
//         reserveInBefore, reserveOutBefore, reserveInAfter, reserveOutAfter, assetOut.
template PrivateSwap(depth) {
    // public
    signal input root;
    signal input nullifierIn;
    signal input outCommitment;
    signal input changeCommitment;
    signal input reserveInBefore;
    signal input reserveOutBefore;
    signal input reserveInAfter;
    signal input reserveOutAfter;
    signal input assetOut;
    // private
    signal input ownerSk;
    signal input inAmount;
    signal input rhoIn;
    signal input leafIndex;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input amountIn;
    signal input amountOut;
    signal input rhoOut;
    signal input rhoChange;

    // 1. ownership + nullifier
    component nf = Nullifier();
    nf.ownerSk <== ownerSk;
    nf.rho <== rhoIn;
    nf.leafIndex <== leafIndex;
    nullifierIn === nf.nullifier;

    // 2. input note membership (input asset = COLLATERAL 0)
    component inNote = NoteCommitment();
    inNote.asset <== 0;
    inNote.amount <== inAmount;
    inNote.ownerPk <== nf.ownerPk;
    inNote.rho <== rhoIn;

    component mk = MerkleInclusion(depth);
    mk.leaf <== inNote.commitment;
    mk.root <== root;
    for (var i = 0; i < depth; i++) {
        mk.pathElements[i] <== pathElements[i];
        mk.pathIndices[i] <== pathIndices[i];
    }

    // 3. value conservation: amountIn + change == inAmount, amountIn <= inAmount
    signal change;
    change <== inAmount - amountIn;
    component chLt = LessThan(252);
    chLt.in[0] <== amountIn;
    chLt.in[1] <== inAmount + 1;
    chLt.out === 1;

    // 4. AMM: reserves move by the trade, constant product preserved.
    // Strict equality kept. Products are bound to intermediate signals because
    // circom only permits quadratic constraints (a*b===c*d is degree-4); each
    // product is one quadratic constraint, then we assert the two are equal.
    reserveInAfter === reserveInBefore + amountIn;
    reserveOutAfter === reserveOutBefore - amountOut;
    signal kBefore;
    signal kAfter;
    kBefore <== reserveInBefore * reserveOutBefore;
    kAfter <== reserveInAfter * reserveOutAfter;
    kBefore === kAfter;

    // assetOut is YES(1) or NO(2)
    (assetOut - 1) * (assetOut - 2) === 0;

    // 5. output + change commitments well-formed
    component outNote = NoteCommitment();
    outNote.asset <== assetOut;
    outNote.amount <== amountOut;
    outNote.ownerPk <== nf.ownerPk;
    outNote.rho <== rhoOut;
    outCommitment === outNote.commitment;

    component chNote = NoteCommitment();
    chNote.asset <== 0;
    chNote.amount <== change;
    chNote.ownerPk <== nf.ownerPk;
    chNote.rho <== rhoChange;
    changeCommitment === chNote.commitment;
}

component main {public [root, nullifierIn, outCommitment, changeCommitment,
    reserveInBefore, reserveOutBefore, reserveInAfter, reserveOutAfter, assetOut]}
    = PrivateSwap(20);

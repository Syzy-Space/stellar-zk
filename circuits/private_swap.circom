pragma circom 2.1.9;
include "lib/note.circom";
include "lib/nullifier.circom";
include "lib/merkle.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

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
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input amountIn;
    signal input amountOut;
    signal input rhoOut;
    signal input rhoChange;

    // Range-check every value/reserve signal to [0, 2^64). These checks are
    // LOAD-BEARING for soundness: the AMM and conservation constraints below
    // are field-element arithmetic with no inherent ordering. Without bounds a
    // prover can supply a wrapped negative value (e.g. amountOut > reserve, or
    // amountIn > inAmount) that still satisfies the field equalities and drain
    // the pool. Forcing the results of the field subtractions `change` and
    // `reserveOutAfter` into [0, 2^64) makes underflow impossible, which turns
    // `amountIn <= inAmount` and `amountOut <= reserveOutBefore` into real
    // integer inequalities. reserveInAfter = reserveInBefore + amountIn is
    // likewise range-bound to prevent additive overflow past the field.
    component rc_inAmount = Num2Bits(64);
    rc_inAmount.in <== inAmount;
    component rc_amountIn = Num2Bits(64);
    rc_amountIn.in <== amountIn;
    component rc_amountOut = Num2Bits(64);
    rc_amountOut.in <== amountOut;
    component rc_reserveInBefore = Num2Bits(64);
    rc_reserveInBefore.in <== reserveInBefore;
    component rc_reserveOutBefore = Num2Bits(64);
    rc_reserveOutBefore.in <== reserveOutBefore;
    component rc_reserveInAfter = Num2Bits(64);
    rc_reserveInAfter.in <== reserveInAfter;
    component rc_reserveOutAfter = Num2Bits(64);
    rc_reserveOutAfter.in <== reserveOutAfter;

    // leafIndex is derived from the (bit-constrained) Merkle pathIndices rather
    // than taken as a free input, so a note can only ever be nullified for its
    // actual tree position — this prevents minting distinct nullifiers for the
    // same note (double-spend). pathIndices bits are constrained inside
    // MerkleInclusion below; the same array feeds both.
    signal leafIndex;
    var acc = 0;
    for (var i = 0; i < depth; i++) { acc += pathIndices[i] * (1 << i); }
    leafIndex <== acc;

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
    // Range-check change to [0, 2^64): with inAmount already bounded, this
    // makes the field subtraction non-underflowing and enforces the real
    // integer inequality amountIn <= inAmount.
    component rc_change = Num2Bits(64);
    rc_change.in <== change;
    // chLt is now redundant with the Num2Bits(64) on `change` above, but kept
    // as a harmless belt-and-suspenders assertion.
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

// Tree depth 8 (256 leaves) — matches unshield, the pool's merkle::DEPTH and the
// client's MERKLE_DEPTH. Small depth keeps the pool's TWO on-chain Poseidon
// inserts (out + change) plus the pairing verify inside the Soroban CPU budget.
component main {public [root, nullifierIn, outCommitment, changeCommitment,
    reserveInBefore, reserveOutBefore, reserveInAfter, reserveOutAfter, assetOut]}
    = PrivateSwap(8);

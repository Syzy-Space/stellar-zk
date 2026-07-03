pragma circom 2.1.9;
include "lib/note.circom";
include "lib/nullifier.circom";
include "lib/merkle.circom";

// Public: root, nullifier, withdrawAmount, recipient.
// Private: ownerSk, rho, pathElements, pathIndices. asset = COLLATERAL(0).
// leafIndex is derived from pathIndices, not a free input.
template Unshield(depth) {
    signal input root;            // public
    signal input nullifier;       // public
    signal input withdrawAmount;  // public
    signal input recipient;       // public (bound; not otherwise used)
    signal input ownerSk;         // private
    signal input rho;             // private
    signal input pathElements[depth]; // private
    signal input pathIndices[depth];  // private

    // recipient binding: force it into the constraint system
    signal recipientSq;
    recipientSq <== recipient * recipient;

    // Derive leafIndex from the (bit-constrained) Merkle pathIndices instead of
    // taking it as a free input, so the note can only be nullified for its real
    // tree position — prevents minting distinct nullifiers for the same note
    // (double-spend). pathIndices bits are constrained inside MerkleInclusion.
    signal leafIndex;
    var acc = 0;
    for (var i = 0; i < depth; i++) { acc += pathIndices[i] * (1 << i); }
    leafIndex <== acc;

    component nf = Nullifier();
    nf.ownerSk <== ownerSk;
    nf.rho <== rho;
    nf.leafIndex <== leafIndex;
    nullifier === nf.nullifier;

    component note = NoteCommitment();
    note.asset <== 0;
    note.amount <== withdrawAmount;
    note.ownerPk <== nf.ownerPk;
    note.rho <== rho;

    component mk = MerkleInclusion(depth);
    mk.leaf <== note.commitment;
    mk.root <== root;
    for (var i = 0; i < depth; i++) {
        mk.pathElements[i] <== pathElements[i];
        mk.pathIndices[i] <== pathIndices[i];
    }
}

// Tree depth 8 (256 leaves). Kept small so the pool's on-chain Poseidon Merkle
// insert (DEPTH hashes) plus the Groth16 pairing verify fit the Soroban CPU
// budget. Must match contracts/shielded_pool merkle::DEPTH and the client's
// MERKLE_DEPTH.
component main {public [root, nullifier, withdrawAmount, recipient]} = Unshield(8);

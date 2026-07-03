pragma circom 2.1.9;
include "lib/note.circom";
include "lib/nullifier.circom";
include "lib/merkle.circom";

// Public: root, nullifier, withdrawAmount, recipient.
// Private: ownerSk, rho, leafIndex, pathElements, pathIndices. asset = COLLATERAL(0).
template Unshield(depth) {
    signal input root;            // public
    signal input nullifier;       // public
    signal input withdrawAmount;  // public
    signal input recipient;       // public (bound; not otherwise used)
    signal input ownerSk;         // private
    signal input rho;             // private
    signal input leafIndex;       // private
    signal input pathElements[depth]; // private
    signal input pathIndices[depth];  // private

    // recipient binding: force it into the constraint system
    signal recipientSq;
    recipientSq <== recipient * recipient;

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

component main {public [root, nullifier, withdrawAmount, recipient]} = Unshield(20);

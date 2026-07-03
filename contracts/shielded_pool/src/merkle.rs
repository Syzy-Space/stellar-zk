//! Incremental Poseidon Merkle tree (depth 8), circomlib/Tornado-style.
//!
//! - empty leaf = 0
//! - node = Poseidon(left, right)
//! - zeros[0] = 0, zeros[i] = Poseidon(zeros[i-1], zeros[i-1])
//! - inserting a leaf walks from the leaf to the root: at each level, if the
//!   node is a LEFT child (bit 0) we stash it in `filled_subtrees[level]` and
//!   hash it against zeros[level]; if it is a RIGHT child (bit 1) we hash the
//!   stashed left sibling against it.
//!
//! Matches the JS `singleLeafPath` reference: a leaf at index 0 uses zeros[i]
//! as the right sibling at every level.

use soroban_sdk::{contracttype, BytesN, Env, Vec};

use crate::poseidon2_be;

// Tree depth 8 (256 leaves). Small by design: each `insert` performs DEPTH
// Poseidon hashes on-chain, and private_swap does TWO inserts plus a Groth16
// pairing verify — at depth 20 that exceeded the Soroban CPU instruction
// budget. Must match the circuits' MerkleInclusion depth and the client's
// MERKLE_DEPTH.
pub const DEPTH: u32 = 8;

#[contracttype]
pub enum MerkleKey {
    /// The frontier: `filled_subtrees[i]` = left-sibling hash cached at level i.
    Frontier,
    /// Current tree root.
    Root,
    /// Next free leaf index (== number of leaves inserted).
    NextIndex,
    /// Set of known roots (current + history) for membership-proof acceptance.
    KnownRoot(BytesN<32>),
    /// Cached zero-subtree roots (`zeros[0..=DEPTH]`), computed once at init.
    /// Storing these avoids recomputing 20 Poseidon hashes on every insert —
    /// the recompute alone (~350M instructions) blows the Soroban CPU budget
    /// when combined with the on-chain Groth16 pairing verify.
    Zeros,
}

/// Compute the zero-subtree roots. Returned as a Vec for convenient indexing.
fn zero_roots(env: &Env) -> Vec<BytesN<32>> {
    let mut v: Vec<BytesN<32>> = Vec::new(env);
    let mut cur = [0u8; 32];
    v.push_back(BytesN::from_array(env, &cur)); // zeros[0] = 0
    let mut i = 0u32;
    while i < DEPTH {
        cur = poseidon2_be(&cur, &cur);
        v.push_back(BytesN::from_array(env, &cur));
        i += 1;
    }
    v
}

/// Initialize an empty tree: frontier = zeros[0..DEPTH], root = zeros[DEPTH].
pub fn init(env: &Env) {
    let zr = zero_roots(env);

    // frontier[i] = zeros[i] (the default left sibling before any insert).
    let mut frontier: Vec<BytesN<32>> = Vec::new(env);
    let mut i = 0u32;
    while i < DEPTH {
        frontier.push_back(zr.get(i).unwrap());
        i += 1;
    }

    let root = zr.get(DEPTH).unwrap();

    let storage = env.storage();
    storage.instance().set(&MerkleKey::Frontier, &frontier);
    // Cache the full zeros vector so `insert` never recomputes it.
    storage.instance().set(&MerkleKey::Zeros, &zr);
    storage.instance().set(&MerkleKey::Root, &root);
    storage.instance().set(&MerkleKey::NextIndex, &0u32);
    storage
        .persistent()
        .set(&MerkleKey::KnownRoot(root.clone()), &true);
}

/// Insert `leaf`, returning `(new_root, leaf_index)`.
pub fn insert(env: &Env, leaf: BytesN<32>) -> (BytesN<32>, u32) {
    let storage = env.storage();
    let mut index: u32 = storage.instance().get(&MerkleKey::NextIndex).unwrap();
    let mut frontier: Vec<BytesN<32>> = storage.instance().get(&MerkleKey::Frontier).unwrap();
    // Read cached zeros (computed once at init) instead of recomputing 20
    // Poseidon hashes per insert.
    let zr: Vec<BytesN<32>> = storage.instance().get(&MerkleKey::Zeros).unwrap();

    let leaf_index = index;
    let mut cur = leaf.to_array();

    let mut level = 0u32;
    while level < DEPTH {
        let node: [u8; 32];
        if index & 1 == 0 {
            // Left child: cache this node as the left sibling at this level,
            // hash against the empty-subtree root on the right.
            frontier.set(level, BytesN::from_array(env, &cur));
            let right = zr.get(level).unwrap().to_array();
            node = poseidon2_be(&cur, &right);
        } else {
            // Right child: hash the cached left sibling against this node.
            let left = frontier.get(level).unwrap().to_array();
            node = poseidon2_be(&left, &cur);
        }
        cur = node;
        index >>= 1;
        level += 1;
    }

    let new_root = BytesN::from_array(env, &cur);

    storage.instance().set(&MerkleKey::Frontier, &frontier);
    storage.instance().set(&MerkleKey::Root, &new_root);
    storage
        .instance()
        .set(&MerkleKey::NextIndex, &(leaf_index + 1));
    storage
        .persistent()
        .set(&MerkleKey::KnownRoot(new_root.clone()), &true);

    (new_root, leaf_index)
}

pub fn current_root(env: &Env) -> BytesN<32> {
    env.storage().instance().get(&MerkleKey::Root).unwrap()
}

pub fn next_index(env: &Env) -> u32 {
    env.storage().instance().get(&MerkleKey::NextIndex).unwrap()
}

pub fn is_known_root(env: &Env, root: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get(&MerkleKey::KnownRoot(root.clone()))
        .unwrap_or(false)
}

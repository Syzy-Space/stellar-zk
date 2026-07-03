#![no_std]

//! Compact, no-ark, circomlib-compatible Poseidon(2) over the BN254 scalar field.
//!
//! Field arithmetic is a hand-vendored Montgomery field over `[u64; 4]` limbs
//! (CIOS multiply), see `field.rs`. No arkworks, no light-poseidon, no big-int
//! crate — this keeps the compiled Soroban wasm tiny (deployable to testnet).
//!
//! The hash follows the UNOPTIMIZED circomlib reference Poseidon (t=3):
//! for each of RF+RP rounds: add round constants, apply the x^5 S-box
//! (full rounds: all 3 lanes; partial rounds: lane 0 only), then multiply by
//! the 3x3 MDS matrix M (state[i] = sum_j M[i][j]*state[j]). The pre-image
//! state is [capacity=0, left, right] (capacity element FIRST), and the digest
//! is state[0] after the permutation. Constants (C, M) are the exact circomlib
//! t=3 set, generated into `constants.rs` from circomlibjs. Output matches
//! circomlibjs `buildPoseidon` bit-for-bit.

use soroban_sdk::{contract, contractimpl, BytesN, Env};

mod constants;
mod field;

use constants::{C, M};
use field::Fr;

/// Poseidon t=3 parameters (circomlib): 8 full rounds, 57 partial rounds.
const T: usize = 3;
const N_ROUNDS_F: usize = 8;
const N_ROUNDS_P: usize = 57;

/// Multiply the length-T state by the MDS matrix M: out[i] = sum_j M[i][j]*s[j].
#[inline]
fn mix(state: &[Fr; T]) -> [Fr; T] {
    let mut out = [Fr::ZERO; T];
    let mut i = 0;
    while i < T {
        let mut acc = Fr::ZERO;
        let mut j = 0;
        while j < T {
            acc = acc.add(&M[i][j].mul(&state[j]));
            j += 1;
        }
        out[i] = acc;
        i += 1;
    }
    out
}

/// Compute circomlib Poseidon(left, right) over BN254 Fr.
/// Inputs/outputs are 32-byte big-endian field elements.
pub fn poseidon2_be(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    // Capacity lane = 0 (FIRST), then the two inputs.
    let mut state: [Fr; T] = [
        Fr::ZERO,
        Fr::from_be_bytes(left),
        Fr::from_be_bytes(right),
    ];

    let n_rounds = N_ROUNDS_F + N_ROUNDS_P;
    let half_f = N_ROUNDS_F / 2;

    let mut r = 0usize;
    while r < n_rounds {
        // 1. Add round constants.
        let mut i = 0;
        while i < T {
            state[i] = state[i].add(&C[r * T + i]);
            i += 1;
        }

        // 2. S-box: full rounds hit every lane, partial rounds only lane 0.
        if r < half_f || r >= half_f + N_ROUNDS_P {
            let mut i = 0;
            while i < T {
                state[i] = state[i].pow5();
                i += 1;
            }
        } else {
            state[0] = state[0].pow5();
        }

        // 3. MDS mix.
        state = mix(&state);
        r += 1;
    }

    state[0].to_be_bytes()
}

#[contract]
pub struct PoseidonProbe;

#[contractimpl]
impl PoseidonProbe {
    /// Hash two 32-byte BE field elements with circomlib Poseidon(2).
    pub fn hash2(env: Env, left: BytesN<32>, right: BytesN<32>) -> BytesN<32> {
        let l = left.to_array();
        let r = right.to_array();
        BytesN::from_array(&env, &poseidon2_be(&l, &r))
    }
}

#[cfg(test)]
mod test;

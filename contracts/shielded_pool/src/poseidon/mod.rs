//! Compact, no-ark, circomlib-compatible Poseidon(2) over the BN254 scalar field.
//!
//! Vendored verbatim from `poseidon_probe` (field.rs, constants.rs + the
//! permutation below). Output matches circomlibjs `buildPoseidon` bit-for-bit.
//! `poseidon2_be` is kept IDENTICAL so contract Merkle roots match client proofs.

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

#[cfg(test)]
mod test {
    use super::poseidon2_be;

    fn h(s: &str) -> [u8; 32] {
        let v = hex::decode(s).unwrap();
        let mut b = [0u8; 32];
        b[32 - v.len()..].copy_from_slice(&v);
        b
    }

    #[test]
    fn poseidon_sanity_1_2() {
        // poseidon([1,2]) from circomlibjs — confirms the vendored copy is intact.
        let left = h("0000000000000000000000000000000000000000000000000000000000000001");
        let right = h("0000000000000000000000000000000000000000000000000000000000000002");
        let got = poseidon2_be(&left, &right);
        let want = h("115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a");
        assert_eq!(got, want, "got={}", hex::encode(got));
    }
}

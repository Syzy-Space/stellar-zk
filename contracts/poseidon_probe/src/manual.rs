//! Vendored-manual circomlib Poseidon(2) over BN254 Fr using no_std field.rs.
use crate::constants::{C, M, RF, RP, T};
use crate::field::Fr;

/// circomlib Poseidon permutation, t=3 (arity 2). state[0] is the capacity (0).
fn permute(state: &mut [Fr; T]) {
    let half_full = RF / 2;
    let mut round_ctr = 0usize;

    // helper: add round constants for this round (T constants)
    let add_rc = |state: &mut [Fr; T], round_ctr: &mut usize| {
        for i in 0..T {
            state[i] = state[i].add(&C[*round_ctr]);
            *round_ctr += 1;
        }
    };
    let mix = |state: &mut [Fr; T]| {
        let mut new = [Fr::zero(); T];
        for i in 0..T {
            let mut acc = Fr::zero();
            for j in 0..T {
                acc = acc.add(&M[i][j].mul(&state[j]));
            }
            new[i] = acc;
        }
        *state = new;
    };

    // first half full rounds
    for _ in 0..half_full {
        add_rc(state, &mut round_ctr);
        for i in 0..T { state[i] = state[i].pow5(); }
        mix(state);
    }
    // partial rounds
    for _ in 0..RP {
        add_rc(state, &mut round_ctr);
        state[0] = state[0].pow5();
        mix(state);
    }
    // second half full rounds
    for _ in 0..half_full {
        add_rc(state, &mut round_ctr);
        for i in 0..T { state[i] = state[i].pow5(); }
        mix(state);
    }
}

pub fn poseidon2_be(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut state = [
        Fr::zero(),
        Fr::from_be_bytes(left),
        Fr::from_be_bytes(right),
    ];
    permute(&mut state);
    state[0].to_be_bytes()
}

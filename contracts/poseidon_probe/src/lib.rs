#![no_std]

//! De-risking probe: circomlib-compatible Poseidon(2) over BN254 Fr inside a
//! Soroban contract, using `light-poseidon-nostd` (pure-Rust ark-ff arithmetic,
//! no host bn254 field ops needed).

use ark_bn254::Fr;
use ark_ff::{BigInteger, PrimeField};
use light_poseidon_nostd::{Poseidon, PoseidonHasher};
use soroban_sdk::{contract, contractimpl, BytesN, Env};

/// Compute circomlib Poseidon(left, right) over BN254 Fr.
/// Inputs/outputs are 32-byte big-endian field elements (canonical, < r).
pub fn poseidon2_be(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let a = Fr::from_be_bytes_mod_order(left);
    let b = Fr::from_be_bytes_mod_order(right);
    let mut hasher = Poseidon::<Fr>::new_circom(2).expect("circom params t=3");
    let out = hasher.hash(&[a, b]).expect("poseidon hash");
    let bytes = out.into_bigint().to_bytes_be(); // Vec<u8>, len<=32
    let mut buf = [0u8; 32];
    // left-pad to 32 (big-endian)
    let n = bytes.len();
    buf[32 - n..].copy_from_slice(&bytes);
    buf
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

mod test;

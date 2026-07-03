#![no_std]

//! BN254 Groth16 proof verifier for Soroban.
//!
//! Verifies a real snarkjs/arkworks BN254 (alt_bn128) Groth16 proof inside the
//! Soroban host. Encoding is Ethereum-compatible uncompressed big-endian:
//!   * G1 = be(x) || be(y)                          (64 bytes)
//!   * G2 = be(x_c1)||be(x_c0)||be(y_c1)||be(y_c0)  (128 bytes)
//!   * Fr = 32-byte big-endian scalar
//!
//! Verification equation (Groth16):
//!   e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
//! where vk_x = IC[0] + Σ public_i * IC[i+1].

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Fr},
    BytesN, Env, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Vkey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
pub enum DataKey {
    Vk(Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    VkNotSet = 1,
    BadPublicInputs = 2,
}

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Store the verifying key for `circuit`.
    ///
    /// PoC: no auth gate. Hardening MUST add `env.current_contract_address()`
    /// admin `require_auth()` before allowing vk registration/rotation.
    pub fn set_vk(env: Env, circuit: Symbol, vk: Vkey) {
        env.storage()
            .instance()
            .set(&DataKey::Vk(circuit), &vk);
    }

    /// Verify a Groth16 proof of `circuit` over `public_inputs`.
    ///
    /// Returns `true` iff the proof is valid.
    pub fn verify(
        env: Env,
        circuit: Symbol,
        a: BytesN<64>,
        b: BytesN<128>,
        c: BytesN<64>,
        public_inputs: Vec<BytesN<32>>,
    ) -> bool {
        let vk: Vkey = env
            .storage()
            .instance()
            .get(&DataKey::Vk(circuit))
            .expect("vk not set");

        // One IC element per public input, plus IC[0].
        assert!(
            public_inputs.len() + 1 == vk.ic.len(),
            "public input count mismatch with vk.ic"
        );

        let bn = env.crypto().bn254();

        // vk_x = IC[0] + Σ public_i * IC[i+1]
        let mut vk_x = Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap());
        for i in 0..public_inputs.len() {
            let scalar = Fr::from_bytes(public_inputs.get(i).unwrap());
            let ic_point = Bn254G1Affine::from_bytes(vk.ic.get(i + 1).unwrap());
            let term = bn.g1_mul(&ic_point, &scalar);
            vk_x = bn.g1_add(&vk_x, &term);
        }

        // Negate A: (x, y) -> (x, p - y). Use the SDK's canonical field
        // negation via `Neg`, which correctly handles the y == 0 (point at
        // infinity) edge case. See `negate_g1_bytes` for the equivalent
        // explicit byte-level construction.
        let a_point = Bn254G1Affine::from_bytes(a);
        let neg_a = -&a_point;

        let alpha = Bn254G1Affine::from_bytes(vk.alpha);
        let c_point = Bn254G1Affine::from_bytes(c);

        let b_point = Bn254G2Affine::from_bytes(b);
        let beta = Bn254G2Affine::from_bytes(vk.beta);
        let gamma = Bn254G2Affine::from_bytes(vk.gamma);
        let delta = Bn254G2Affine::from_bytes(vk.delta);

        // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        let mut g1: Vec<Bn254G1Affine> = Vec::new(&env);
        g1.push_back(neg_a);
        g1.push_back(alpha);
        g1.push_back(vk_x);
        g1.push_back(c_point);

        let mut g2: Vec<Bn254G2Affine> = Vec::new(&env);
        g2.push_back(b_point);
        g2.push_back(beta);
        g2.push_back(gamma);
        g2.push_back(delta);

        bn.pairing_check(g1, g2)
    }
}

/// BN254 base field prime p, big-endian.
/// p = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47
const BN254_FP_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// Negate a G1 point given its 64-byte uncompressed encoding: keep x, replace
/// y with (p - y) mod p. Handles the y == 0 / point-at-infinity case (neg is
/// itself). Provided for completeness; `verify` uses the SDK's `Neg` impl which
/// performs the identical canonical field negation.
#[allow(dead_code)]
pub fn negate_g1_bytes(env: &Env, point: &BytesN<64>) -> BytesN<64> {
    let mut buf = point.to_array();

    // y occupies bytes [32..64], big-endian.
    let mut y = [0u8; 32];
    y.copy_from_slice(&buf[32..64]);

    // If y == 0, negation is the point itself.
    if y.iter().all(|&b| b == 0) {
        return BytesN::from_array(env, &buf);
    }

    // neg_y = p - y, big-endian byte subtraction with borrow.
    let mut neg_y = [0u8; 32];
    let mut borrow: i16 = 0;
    for i in (0..32).rev() {
        let diff = BN254_FP_MODULUS_BE[i] as i16 - y[i] as i16 - borrow;
        if diff < 0 {
            neg_y[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            neg_y[i] = diff as u8;
            borrow = 0;
        }
    }

    buf[32..64].copy_from_slice(&neg_y);
    BytesN::from_array(env, &buf)
}

#[cfg(test)]
mod test;

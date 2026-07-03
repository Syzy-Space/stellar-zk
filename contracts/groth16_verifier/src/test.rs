#![cfg(test)]

use super::*;
use num_bigint::BigUint;
use soroban_sdk::{symbol_short, BytesN, Env, Vec};

const FIXTURE: &str = include_str!("testdata/shield.json");

fn json() -> serde_json::Value {
    serde_json::from_str(FIXTURE).expect("valid fixture JSON")
}

/// Decode a hex string into a `BytesN<N>`.
fn bytesn<const N: usize>(env: &Env, hexstr: &str) -> BytesN<N> {
    let bytes = hex::decode(hexstr).expect("valid hex");
    assert_eq!(bytes.len(), N, "hex length mismatch for BytesN<{}>", N);
    let mut arr = [0u8; N];
    arr.copy_from_slice(&bytes);
    BytesN::from_array(env, &arr)
}

/// Convert a decimal string field element into a 32-byte big-endian scalar.
fn scalar_be(env: &Env, dec: &str) -> BytesN<32> {
    let n = BigUint::parse_bytes(dec.as_bytes(), 10).expect("valid decimal");
    let be = n.to_bytes_be();
    assert!(be.len() <= 32, "scalar exceeds 32 bytes");
    let mut arr = [0u8; 32];
    arr[32 - be.len()..].copy_from_slice(&be);
    BytesN::from_array(env, &arr)
}

fn make_vk(env: &Env, v: &serde_json::Value) -> Vkey {
    let vk = &v["vkey"];
    let mut ic: Vec<BytesN<64>> = Vec::new(env);
    for item in vk["ic"].as_array().unwrap() {
        ic.push_back(bytesn::<64>(env, item.as_str().unwrap()));
    }
    Vkey {
        alpha: bytesn::<64>(env, vk["alpha"].as_str().unwrap()),
        beta: bytesn::<128>(env, vk["beta"].as_str().unwrap()),
        gamma: bytesn::<128>(env, vk["gamma"].as_str().unwrap()),
        delta: bytesn::<128>(env, vk["delta"].as_str().unwrap()),
        ic,
    }
}

fn public_inputs(env: &Env, v: &serde_json::Value, override0: Option<&str>) -> Vec<BytesN<32>> {
    let arr = v["public"].as_array().unwrap();
    let mut out: Vec<BytesN<32>> = Vec::new(env);
    for (i, item) in arr.iter().enumerate() {
        let s = if i == 0 {
            override0.unwrap_or(item.as_str().unwrap())
        } else {
            item.as_str().unwrap()
        };
        out.push_back(scalar_be(env, s));
    }
    out
}

#[test]
fn verifies_real_shield_proof() {
    let env = Env::default();
    let contract_id = env.register(Groth16Verifier, ());
    let client = Groth16VerifierClient::new(&env, &contract_id);

    let v = json();
    let circuit = symbol_short!("shield");

    client.set_vk(&circuit, &make_vk(&env, &v));

    let a = bytesn::<64>(&env, v["proof"]["a"].as_str().unwrap());
    let b = bytesn::<128>(&env, v["proof"]["b"].as_str().unwrap());
    let c = bytesn::<64>(&env, v["proof"]["c"].as_str().unwrap());
    let public = public_inputs(&env, &v, None);

    assert!(
        client.verify(&circuit, &a, &b, &c, &public),
        "real shield proof must verify"
    );
}

#[test]
fn rejects_tampered_proof() {
    // We tamper the PUBLIC INPUT (amount 1000 -> 1001) rather than a proof
    // point. Flipping a byte in a G1/G2 point would typically produce an
    // off-curve encoding that panics in `from_bytes`/`pairing_check` instead
    // of cleanly returning false. A tampered public input keeps all points on
    // the curve, so the pairing product simply fails and `verify` returns false.
    let env = Env::default();
    let contract_id = env.register(Groth16Verifier, ());
    let client = Groth16VerifierClient::new(&env, &contract_id);

    let v = json();
    let circuit = symbol_short!("shield");

    client.set_vk(&circuit, &make_vk(&env, &v));

    let a = bytesn::<64>(&env, v["proof"]["a"].as_str().unwrap());
    let b = bytesn::<128>(&env, v["proof"]["b"].as_str().unwrap());
    let c = bytesn::<64>(&env, v["proof"]["c"].as_str().unwrap());
    let public = public_inputs(&env, &v, Some("1001"));

    assert!(
        !client.verify(&circuit, &a, &b, &c, &public),
        "proof must be rejected for tampered public input"
    );
}

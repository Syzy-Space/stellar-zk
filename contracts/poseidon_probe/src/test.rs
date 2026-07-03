#![cfg(test)]

use crate::poseidon2_be;

fn h(s: &str) -> [u8; 32] {
    let v = hex::decode(s).unwrap();
    let mut b = [0u8; 32];
    b[32 - v.len()..].copy_from_slice(&v);
    b
}

#[test]
fn matches_circomlibjs_1_2() {
    // poseidon([1,2]) from circomlibjs buildPoseidon
    let left = h("0000000000000000000000000000000000000000000000000000000000000001");
    let right = h("0000000000000000000000000000000000000000000000000000000000000002");
    let got = poseidon2_be(&left, &right);
    let want = h("115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a");
    assert_eq!(got, want, "got={} want={}", hex::encode(got), hex::encode(want));
}

#[test]
fn matches_circomlibjs_0_0() {
    let z = [0u8; 32];
    let got = poseidon2_be(&z, &z);
    let want = h("2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864");
    assert_eq!(got, want, "got={}", hex::encode(got));
}

#[test]
fn matches_circomlibjs_7_42() {
    let left = h("0000000000000000000000000000000000000000000000000000000000000007");
    let right = h("000000000000000000000000000000000000000000000000000000000000002a"); // 42
    let got = poseidon2_be(&left, &right);
    let want = h("042ca87e7982bd63de6eeea526f89dbdf6d22fe4105bfa205b4c820bf1428988");
    assert_eq!(got, want, "got={}", hex::encode(got));
}

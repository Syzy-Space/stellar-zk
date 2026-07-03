#![cfg(test)]

use super::*;
use num_bigint::BigUint;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{symbol_short, Address, BytesN, Env, Vec};

// Reuse the deployed verifier's real VK + proof fixture.
const FIXTURE: &str = include_str!("../../groth16_verifier/src/testdata/shield.json");

fn json() -> serde_json::Value {
    serde_json::from_str(FIXTURE).expect("valid fixture JSON")
}

fn bytesn<const N: usize>(env: &Env, hexstr: &str) -> BytesN<N> {
    let bytes = hex::decode(hexstr).expect("valid hex");
    assert_eq!(bytes.len(), N, "hex length mismatch for BytesN<{}>", N);
    let mut arr = [0u8; N];
    arr.copy_from_slice(&bytes);
    BytesN::from_array(env, &arr)
}

fn scalar_be(env: &Env, dec: &str) -> BytesN<32> {
    let n = BigUint::parse_bytes(dec.as_bytes(), 10).expect("valid decimal");
    let be = n.to_bytes_be();
    assert!(be.len() <= 32, "scalar exceeds 32 bytes");
    let mut arr = [0u8; 32];
    arr[32 - be.len()..].copy_from_slice(&be);
    BytesN::from_array(env, &arr)
}

// The real verifier contract, registered natively for the shield E2E test.
use groth16_verifier::{Groth16Verifier, Groth16VerifierClient, Vkey};

/// Deploy the verifier, set the shield VK from the fixture, return its id.
fn deploy_verifier(env: &Env, v: &serde_json::Value) -> Address {
    let verifier_id = env.register(Groth16Verifier, ());
    let verifier = Groth16VerifierClient::new(env, &verifier_id);
    let mut ic: Vec<BytesN<64>> = Vec::new(env);
    for item in v["vkey"]["ic"].as_array().unwrap() {
        ic.push_back(bytesn::<64>(env, item.as_str().unwrap()));
    }
    let vk = Vkey {
        alpha: bytesn::<64>(env, v["vkey"]["alpha"].as_str().unwrap()),
        beta: bytesn::<128>(env, v["vkey"]["beta"].as_str().unwrap()),
        gamma: bytesn::<128>(env, v["vkey"]["gamma"].as_str().unwrap()),
        delta: bytesn::<128>(env, v["vkey"]["delta"].as_str().unwrap()),
        ic,
    };
    verifier.set_vk(&symbol_short!("shield"), &vk);
    verifier_id
}

// ---------------------------------------------------------------------------
// 3. Merkle tree matches the JS singleLeafPath reference.
// ---------------------------------------------------------------------------
#[test]
fn merkle_single_leaf_matches_js() {
    let env = Env::default();
    let contract_id = env.register(ShieldedPool, ());

    // The shield fixture's commitment as a 32-byte BE field element.
    let commitment = scalar_be(
        &env,
        "4177540253733635645361238714027443668024359729367908007663945898284069522295",
    );

    // Insert it at index 0 of an empty depth-20 tree.
    let (root, index) = env.as_contract(&contract_id, || {
        crate::merkle::init(&env);
        crate::merkle::insert(&env, commitment.clone())
    });

    assert_eq!(index, 0);

    // Expected root from JS: node = require("circuits/test/helpers.js")
    //   singleLeafPath(L, 20).root, printed as 64-char hex (see report).
    let expected = bytesn::<32>(
        &env,
        "0e5f129b3b39de1281523e69da21c32252d264520dcf087b0170602091972bb2",
    );

    assert_eq!(
        root, expected,
        "Rust merkle root must match JS singleLeafPath root"
    );
}

// ---------------------------------------------------------------------------
// 4. shield success + reject.
// ---------------------------------------------------------------------------

#[test]
fn shield_inserts_commitment_and_moves_tokens() {
    let env = Env::default();
    env.mock_all_auths();

    let v = json();

    let verifier_id = deploy_verifier(&env, &v);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let collateral = sac.address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &collateral);
    let token = soroban_sdk::token::Client::new(&env, &collateral);

    let pool_id = env.register(ShieldedPool, ());
    let pool = ShieldedPoolClient::new(&env, &pool_id);
    pool.init(&admin, &verifier_id, &collateral);

    let from = Address::generate(&env);
    token_admin.mint(&from, &10_000i128);

    let a = bytesn::<64>(&env, v["proof"]["a"].as_str().unwrap());
    let b = bytesn::<128>(&env, v["proof"]["b"].as_str().unwrap());
    let c = bytesn::<64>(&env, v["proof"]["c"].as_str().unwrap());
    let commitment = scalar_be(&env, v["public"][1].as_str().unwrap());
    let amount: i128 = 1000;

    // Screening ref (not on the deny-list).
    let screening_ref = BytesN::from_array(&env, &[0u8; 32]);

    let root_before = pool.root();
    let new_root = pool.shield(&from, &a, &b, &c, &amount, &commitment, &screening_ref);

    // Tokens moved from `from` to pool.
    assert_eq!(token.balance(&from), 9_000i128);
    assert_eq!(token.balance(&pool_id), 1_000i128);

    // Leaf inserted.
    assert_eq!(pool.next_index(), 1);
    assert_ne!(new_root, root_before);

    // Root equals the single-leaf JS reference root.
    let expected = bytesn::<32>(
        &env,
        "0e5f129b3b39de1281523e69da21c32252d264520dcf087b0170602091972bb2",
    );
    assert_eq!(new_root, expected);
    assert_eq!(pool.root(), expected);
    assert!(pool.is_known_root(&expected));
}

#[test]
#[should_panic]
fn shield_rejects_wrong_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let v = json();

    let verifier_id = deploy_verifier(&env, &v);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let collateral = sac.address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &collateral);

    let pool_id = env.register(ShieldedPool, ());
    let pool = ShieldedPoolClient::new(&env, &pool_id);
    pool.init(&admin, &verifier_id, &collateral);

    let from = Address::generate(&env);
    token_admin.mint(&from, &10_000i128);

    let a = bytesn::<64>(&env, v["proof"]["a"].as_str().unwrap());
    let b = bytesn::<128>(&env, v["proof"]["b"].as_str().unwrap());
    let c = bytesn::<64>(&env, v["proof"]["c"].as_str().unwrap());
    let commitment = scalar_be(&env, v["public"][1].as_str().unwrap());

    // Wrong amount (1001 instead of 1000) => public input mismatch => verify
    // returns false => shield panics with ProofInvalid.
    let screening_ref = BytesN::from_array(&env, &[0u8; 32]);
    let bad_amount: i128 = 1001;
    pool.shield(&from, &a, &b, &c, &bad_amount, &commitment, &screening_ref);
}

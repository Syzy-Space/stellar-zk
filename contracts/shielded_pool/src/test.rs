#![cfg(test)]

use super::*;
use num_bigint::BigUint;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env, Symbol, Vec};

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

// ===========================================================================
// Mock (always-true) verifier + rig for unshield/private_swap bookkeeping.
//
// unshield and private_swap have no real proof fixtures yet, so their state
// transitions are exercised against a tiny always-true verifier. Real-proof
// e2e for these comes via the CLI (Plan 3).
// ===========================================================================

#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify(
        _env: Env,
        _circuit: Symbol,
        _a: BytesN<64>,
        _b: BytesN<128>,
        _c: BytesN<64>,
        _public_inputs: Vec<BytesN<32>>,
    ) -> bool {
        true
    }
}

struct Rig {
    env: Env,
    pool: ShieldedPoolClient<'static>,
    token_admin: StellarAssetClient<'static>,
    token: TokenClient<'static>,
    admin: Address,
}

/// Build a pool wired to a mock always-true verifier + a fresh SAC collateral.
fn mock_rig(env: &Env) -> Rig {
    env.mock_all_auths();
    let mv = env.register(MockVerifier, ());

    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let collateral = sac.address();
    let token_admin = StellarAssetClient::new(env, &collateral);
    let token = TokenClient::new(env, &collateral);

    let pool_id = env.register(ShieldedPool, ());
    let pool = ShieldedPoolClient::new(env, &pool_id);
    pool.init(&admin, &mv, &collateral);

    Rig {
        env: env.clone(),
        pool,
        token_admin,
        token,
        admin,
    }
}

fn zero32(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn dummy_proof(env: &Env) -> (BytesN<64>, BytesN<128>, BytesN<64>) {
    (
        BytesN::from_array(env, &[0u8; 64]),
        BytesN::from_array(env, &[0u8; 128]),
        BytesN::from_array(env, &[0u8; 64]),
    )
}

/// Shield `amount` behind `commitment` (via the mock verifier), funding the pool.
fn shield_one(rig: &Rig, commitment: &BytesN<32>, amount: i128) -> BytesN<32> {
    let from = Address::generate(&rig.env);
    rig.token_admin.mint(&from, &amount);
    let (a, b, c) = dummy_proof(&rig.env);
    rig.pool
        .shield(&from, &a, &b, &c, &amount, commitment, &zero32(&rig.env))
}

// ---------------------------------------------------------------------------
// shield deny-list gate
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // ScreeningDenied
fn shield_rejects_denied_screening_ref() {
    let env = Env::default();
    let rig = mock_rig(&env);

    let bad_ref = bytesn::<32>(
        &env,
        "00000000000000000000000000000000000000000000000000000000000000ab",
    );
    rig.pool.set_denied(&bad_ref, &true);
    assert!(rig.pool.is_denied(&bad_ref));

    let from = Address::generate(&env);
    rig.token_admin.mint(&from, &1000i128);
    let (a, b, c) = dummy_proof(&env);
    let commitment = bytesn::<32>(
        &env,
        "093c676c09f760816c5deb3c528055cb4543055763373a36079755e7cdf98b77",
    );
    rig.pool
        .shield(&from, &a, &b, &c, &1000i128, &commitment, &bad_ref);
}

// ---------------------------------------------------------------------------
// unshield
// ---------------------------------------------------------------------------

#[test]
fn unshield_pays_recipient_and_accrues_fee() {
    let env = Env::default();
    let rig = mock_rig(&env);

    let commitment = bytesn::<32>(
        &env,
        "093c676c09f760816c5deb3c528055cb4543055763373a36079755e7cdf98b77",
    );
    let root = shield_one(&rig, &commitment, 1000);

    let (a, b, c) = dummy_proof(&env);
    let nullifier = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000001",
    );
    let recipient = Address::generate(&env);
    let rf = zero32(&env);

    rig.pool
        .unshield(&a, &b, &c, &root, &nullifier, &800i128, &recipient, &rf, &50i128);

    assert!(rig.pool.is_spent(&nullifier));
    assert_eq!(rig.token.balance(&recipient), 750); // 800 - 50 fee
    assert_eq!(rig.pool.fees(), 50);
    assert_eq!(rig.token.balance(&rig.pool.address), 250); // 1000 - 750
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // NullifierUsed
fn unshield_rejects_nullifier_reuse() {
    let env = Env::default();
    let rig = mock_rig(&env);

    let commitment = bytesn::<32>(
        &env,
        "093c676c09f760816c5deb3c528055cb4543055763373a36079755e7cdf98b77",
    );
    let root = shield_one(&rig, &commitment, 1000);

    let (a, b, c) = dummy_proof(&env);
    let nullifier = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000001",
    );
    let recipient = Address::generate(&env);
    let rf = zero32(&env);

    rig.pool
        .unshield(&a, &b, &c, &root, &nullifier, &100i128, &recipient, &rf, &0i128);
    rig.pool
        .unshield(&a, &b, &c, &root, &nullifier, &100i128, &recipient, &rf, &0i128);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")] // UnknownRoot
fn unshield_rejects_unknown_root() {
    let env = Env::default();
    let rig = mock_rig(&env);

    let (a, b, c) = dummy_proof(&env);
    let bogus_root = bytesn::<32>(
        &env,
        "1111111111111111111111111111111111111111111111111111111111111111",
    );
    let nullifier = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000002",
    );
    let recipient = Address::generate(&env);
    let rf = zero32(&env);
    rig.pool.unshield(
        &a, &b, &c, &bogus_root, &nullifier, &100i128, &recipient, &rf, &0i128,
    );
}

// ---------------------------------------------------------------------------
// private_swap
// ---------------------------------------------------------------------------

#[test]
fn private_swap_updates_reserves_inserts_two_leaves_and_credits_fee() {
    let env = Env::default();
    let rig = mock_rig(&env);

    rig.pool.seed_reserves(&1000i128, &1000i128);
    assert_eq!(rig.pool.reserves(), (1000, 1000));

    let index_before = rig.pool.next_index();

    let (a, b, c) = dummy_proof(&env);
    let nullifier = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000003",
    );
    let out_c = bytesn::<32>(
        &env,
        "093c676c09f760816c5deb3c528055cb4543055763373a36079755e7cdf98b77",
    );
    let change_c = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000007",
    );

    // asset_out = YES: reserveIn = NO (1000), reserveOut = YES (1000).
    // After: NO -> 1100 (paid in 100), YES -> 910.
    let root = rig.pool.private_swap(
        &a, &b, &c, &nullifier, &out_c, &change_c, &1000i128, &1000i128, &1100i128, &910i128,
        &ASSET_YES, &5i128,
    );

    assert!(rig.pool.is_spent(&nullifier));
    // yes = out_after (910), no = in_after (1100).
    assert_eq!(rig.pool.reserves(), (910, 1100));
    assert_eq!(rig.pool.next_index(), index_before + 2, "two leaves inserted");
    assert_eq!(rig.pool.root(), root);
    assert!(rig.pool.is_known_root(&root));
    assert_eq!(rig.pool.fees(), 5);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // StaleReserves
fn private_swap_rejects_stale_reserves() {
    let env = Env::default();
    let rig = mock_rig(&env);

    rig.pool.seed_reserves(&1000i128, &1000i128);

    let (a, b, c) = dummy_proof(&env);
    let nullifier = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000004",
    );
    let z = zero32(&env);

    // reserve_out_before claims 999 but on-chain YES is 1000 -> stale.
    rig.pool.private_swap(
        &a, &b, &c, &nullifier, &z, &z, &1000i128, &999i128, &1100i128, &900i128, &ASSET_YES,
        &0i128,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // NullifierUsed
fn private_swap_rejects_nullifier_reuse() {
    let env = Env::default();
    let rig = mock_rig(&env);

    rig.pool.seed_reserves(&1000i128, &1000i128);

    let (a, b, c) = dummy_proof(&env);
    let nullifier = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000005",
    );
    let out_c = bytesn::<32>(
        &env,
        "093c676c09f760816c5deb3c528055cb4543055763373a36079755e7cdf98b77",
    );
    let change_c = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000007",
    );

    rig.pool.private_swap(
        &a, &b, &c, &nullifier, &out_c, &change_c, &1000i128, &1000i128, &1100i128, &910i128,
        &ASSET_YES, &0i128,
    );
    // Reserves are now (910, 1100); reuse the SAME nullifier with fresh reserves.
    rig.pool.private_swap(
        &a, &b, &c, &nullifier, &out_c, &change_c, &1100i128, &910i128, &1150i128, &870i128,
        &ASSET_YES, &0i128,
    );
}

// ---------------------------------------------------------------------------
// fees
// ---------------------------------------------------------------------------

#[test]
fn withdraw_fees_pays_admin_and_zeroes() {
    let env = Env::default();
    let rig = mock_rig(&env);

    let commitment = bytesn::<32>(
        &env,
        "093c676c09f760816c5deb3c528055cb4543055763373a36079755e7cdf98b77",
    );
    let root = shield_one(&rig, &commitment, 1000);
    let (a, b, c) = dummy_proof(&env);
    let nullifier = bytesn::<32>(
        &env,
        "0000000000000000000000000000000000000000000000000000000000000009",
    );
    let recipient = Address::generate(&env);
    let rf = zero32(&env);
    rig.pool
        .unshield(&a, &b, &c, &root, &nullifier, &500i128, &recipient, &rf, &100i128);
    assert_eq!(rig.pool.fees(), 100);

    let paid = rig.pool.withdraw_fees(&rig.admin);
    assert_eq!(paid, 100);
    assert_eq!(rig.pool.fees(), 0);
    assert_eq!(rig.token.balance(&rig.admin), 100);
}

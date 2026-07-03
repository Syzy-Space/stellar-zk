#![no_std]

//! Syzy Shielded Pool — Soroban contract.
//!
//! Holds an incremental Poseidon Merkle tree (depth 20, circomlib-compatible)
//! of note commitments plus a nullifier set, an AMM-style reserve pair, a
//! screening deny-list and an accrued-fee balance. Three privacy-preserving
//! entrypoints are Groth16-proof-gated (via the deployed `groth16_verifier`
//! contract):
//!
//!   * `shield`   — deposit `amount` collateral behind a note `commitment`.
//!   * `unshield` — spend a note (by nullifier) and pay `amount-fee` out.
//!   * `private_swap` — spend a note, swap against the reserves, and mint an
//!     output note + a change note (two new leaves).
//!
//! The pool NEVER computes note commitments; the client supplies them. The pool
//! only computes Merkle PARENT nodes via `Poseidon(left,right)` (see `merkle`).

mod merkle;
mod poseidon;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env,
    Symbol, Vec,
};

pub(crate) use poseidon::poseidon2_be;

#[contracttype]
pub enum DataKey {
    /// Set once by `init`; guards re-init and holds config (admin/verifier/collateral).
    Config,
    /// Spent-note set: `Nullifier(n) -> true` once a note is spent.
    Nullifier(BytesN<32>),
    /// Reserve of the YES leg of the swap pair (asset id 0).
    ReserveYes,
    /// Reserve of the NO leg of the swap pair (asset id 1).
    ReserveNo,
    /// Screening deny-list: `Denied(ref) -> true` blocks a shield with that ref.
    Denied(BytesN<32>),
    /// Accrued protocol fees (collateral units) withdrawable by the admin.
    Fees,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub verifier: Address,
    pub collateral: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ProofInvalid = 3,
    AmountNotPositive = 4,
    ScreeningDenied = 5,
    NullifierUsed = 6,
    UnknownRoot = 7,
    StaleReserves = 8,
    BadFee = 9,
    BadAssetOut = 10,
    BadReserves = 11,
}

/// YES leg asset id (used as `asset_out` selector in `private_swap`).
pub const ASSET_YES: u32 = 0;
/// NO leg asset id.
pub const ASSET_NO: u32 = 1;

#[contract]
pub struct ShieldedPool;

#[contractimpl]
impl ShieldedPool {
    /// One-time setup. Stores admin, the verifier contract id and the collateral
    /// SAC address; initializes the empty Merkle tree, zeroes the reserves and
    /// the fee balance. Panics if already initialized.
    pub fn init(env: Env, admin: Address, verifier: Address, collateral: Address) {
        if env.storage().instance().has(&DataKey::Config) {
            panic_with_error(&env, Error::AlreadyInitialized);
        }
        let cfg = Config {
            admin,
            verifier,
            collateral,
        };
        let s = env.storage().instance();
        s.set(&DataKey::Config, &cfg);
        s.set(&DataKey::ReserveYes, &0i128);
        s.set(&DataKey::ReserveNo, &0i128);
        s.set(&DataKey::Fees, &0i128);
        // Initialize the empty tree (root = zeros[DEPTH], next_index = 0).
        merkle::init(&env);
    }

    // --------------------------------------------------------------------- //
    // Admin operations
    // --------------------------------------------------------------------- //

    /// Seed the swap reserves. Admin-only. Does NOT move tokens — the reserves
    /// are an internal AMM accounting pair the swap proofs are checked against.
    pub fn seed_reserves(env: Env, yes: i128, no: i128) {
        require_admin(&env);
        if yes < 0 || no < 0 {
            panic_with_error(&env, Error::BadReserves);
        }
        let s = env.storage().instance();
        s.set(&DataKey::ReserveYes, &yes);
        s.set(&DataKey::ReserveNo, &no);
    }

    /// Add or remove a screening reference from the deny-list. Admin-only.
    pub fn set_denied(env: Env, screening_ref: BytesN<32>, denied: bool) {
        require_admin(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Denied(screening_ref), &denied);
    }

    /// Whether a screening reference is currently denied.
    pub fn is_denied(env: Env, screening_ref: BytesN<32>) -> bool {
        is_denied_ref(&env, &screening_ref)
    }

    /// Withdraw all accrued fees to `to`. Admin-only.
    pub fn withdraw_fees(env: Env, to: Address) -> i128 {
        require_admin(&env);
        let s = env.storage().instance();
        let fees: i128 = s.get(&DataKey::Fees).unwrap_or(0);
        if fees > 0 {
            let cfg = config(&env);
            let tok = token::Client::new(&env, &cfg.collateral);
            tok.transfer(&env.current_contract_address(), &to, &fees);
            s.set(&DataKey::Fees, &0i128);
        }
        fees
    }

    // --------------------------------------------------------------------- //
    // Shielded entrypoints
    // --------------------------------------------------------------------- //

    /// Shield `amount` of collateral behind `commitment`.
    ///
    /// 1. `from.require_auth()` and screening check on `screening_ref`.
    /// 2. Verify the Groth16 `shield` proof over public inputs [amount, commitment].
    /// 3. Pull `amount` collateral from `from` into the pool.
    /// 4. Insert `commitment` as a Merkle leaf; record the new root as known;
    ///    emit `("shield", commitment) -> (index, new_root)`.
    pub fn shield(
        env: Env,
        from: Address,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        amount: i128,
        commitment: BytesN<32>,
        screening_ref: BytesN<32>,
    ) -> BytesN<32> {
        from.require_auth();

        if amount <= 0 {
            panic_with_error(&env, Error::AmountNotPositive);
        }
        if is_denied_ref(&env, &screening_ref) {
            panic_with_error(&env, Error::ScreeningDenied);
        }

        let cfg = config(&env);

        // Public inputs for the `shield` circuit: [amount, commitment].
        let mut public_inputs: Vec<BytesN<32>> = Vec::new(&env);
        public_inputs.push_back(i128_to_fr_be(&env, amount));
        public_inputs.push_back(commitment.clone());
        verify(&env, &cfg, symbol_short!("shield"), &proof_a, &proof_b, &proof_c, public_inputs);

        // Pull collateral into the pool.
        let tok = token::Client::new(&env, &cfg.collateral);
        tok.transfer(&from, &env.current_contract_address(), &amount);

        // Insert the commitment into the Merkle tree.
        let (new_root, index) = merkle::insert(&env, commitment.clone());

        env.events()
            .publish((symbol_short!("shield"), commitment), (index, new_root.clone()));

        new_root
    }

    /// Unshield: spend a note (identified by `nullifier`, proven a member of the
    /// tree at `root`) and pay `withdraw_amount - fee` collateral to `recipient`.
    ///
    /// Public inputs for the `unshield` circuit:
    ///   [root, nullifier, withdrawAmount, recipient_field].
    ///
    /// Recipient binding (PoC): the circuit takes `recipient` as a raw field
    /// element `recipient_field`. We take BOTH `recipient_field: BytesN<32>`
    /// (the value the proof commits to) and `recipient: Address` (the payout
    /// target). Binding `recipient_field <-> recipient` is a KNOWN PoC GAP — the
    /// CLI (Plan 3) is responsible for deriving `recipient_field` from the
    /// Address and both sides MUST agree. This contract does not enforce the
    /// binding.
    pub fn unshield(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        root: BytesN<32>,
        nullifier: BytesN<32>,
        withdraw_amount: i128,
        recipient: Address,
        recipient_field: BytesN<32>,
        fee: i128,
    ) {
        if withdraw_amount <= 0 {
            panic_with_error(&env, Error::AmountNotPositive);
        }
        if fee < 0 || fee > withdraw_amount {
            panic_with_error(&env, Error::BadFee);
        }
        if !merkle::is_known_root(&env, &root) {
            panic_with_error(&env, Error::UnknownRoot);
        }
        if is_nullifier_used(&env, &nullifier) {
            panic_with_error(&env, Error::NullifierUsed);
        }

        let cfg = config(&env);

        let mut public_inputs: Vec<BytesN<32>> = Vec::new(&env);
        public_inputs.push_back(root);
        public_inputs.push_back(nullifier.clone());
        public_inputs.push_back(i128_to_fr_be(&env, withdraw_amount));
        public_inputs.push_back(recipient_field);
        verify(&env, &cfg, symbol_short!("unshield"), &proof_a, &proof_b, &proof_c, public_inputs);

        // Mark the note spent BEFORE paying out.
        mark_nullifier(&env, &nullifier);

        // Pay recipient (withdraw_amount - fee); accrue fee.
        let payout = withdraw_amount - fee;
        let tok = token::Client::new(&env, &cfg.collateral);
        if payout > 0 {
            tok.transfer(&env.current_contract_address(), &recipient, &payout);
        }
        accrue_fee(&env, fee);

        env.events()
            .publish((symbol_short!("unshield"), nullifier), (withdraw_amount, fee));
    }

    /// Private swap: spend an input note (by `nullifier_in`) against the reserves,
    /// minting `out_commitment` (the swapped output note) and `change_commitment`
    /// (the change note) as two new leaves.
    ///
    /// `asset_out` selects which leg the trader receives:
    ///   * `ASSET_YES (0)` -> reserveIn = NO,  reserveOut = YES
    ///   * `ASSET_NO  (1)` -> reserveIn = YES, reserveOut = NO
    ///
    /// The caller passes the `*_before` reserves as public inputs; we require
    /// they equal the CURRENT on-chain reserves (freshness / no stale proof
    /// replay), then set the reserves to the `*_after` values.
    ///
    /// Public inputs for the `private_swap` circuit (ordering fixed by the circuit):
    ///   [root, nullifierIn, outCommitment, changeCommitment,
    ///    reserveInBefore, reserveOutBefore, reserveInAfter, reserveOutAfter, assetOut].
    /// NB: the circuit's `assetOut` public input is the note-scheme asset id
    /// (YES=1, NO=2), so we push `asset_out + 1` below.
    pub fn private_swap(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        nullifier_in: BytesN<32>,
        out_commitment: BytesN<32>,
        change_commitment: BytesN<32>,
        reserve_in_before: i128,
        reserve_out_before: i128,
        reserve_in_after: i128,
        reserve_out_after: i128,
        asset_out: u32,
        fee: i128,
    ) -> BytesN<32> {
        if asset_out != ASSET_YES && asset_out != ASSET_NO {
            panic_with_error(&env, Error::BadAssetOut);
        }
        if fee < 0 {
            panic_with_error(&env, Error::BadFee);
        }
        if reserve_in_after < 0 || reserve_out_after < 0 {
            panic_with_error(&env, Error::BadReserves);
        }
        if is_nullifier_used(&env, &nullifier_in) {
            panic_with_error(&env, Error::NullifierUsed);
        }

        // Map (in/out) reserves onto (yes/no) per asset_out and enforce freshness.
        let (cur_yes, cur_no) = reserves(&env);
        let (expect_in, expect_out) = if asset_out == ASSET_YES {
            // Receiving YES: pay in NO, take out YES.
            (cur_no, cur_yes)
        } else {
            // Receiving NO: pay in YES, take out NO.
            (cur_yes, cur_no)
        };
        if reserve_in_before != expect_in || reserve_out_before != expect_out {
            panic_with_error(&env, Error::StaleReserves);
        }

        let cfg = config(&env);
        let root = merkle::current_root(&env);

        let mut public_inputs: Vec<BytesN<32>> = Vec::new(&env);
        public_inputs.push_back(root);
        public_inputs.push_back(nullifier_in.clone());
        public_inputs.push_back(out_commitment.clone());
        public_inputs.push_back(change_commitment.clone());
        public_inputs.push_back(i128_to_fr_be(&env, reserve_in_before));
        public_inputs.push_back(i128_to_fr_be(&env, reserve_out_before));
        public_inputs.push_back(i128_to_fr_be(&env, reserve_in_after));
        public_inputs.push_back(i128_to_fr_be(&env, reserve_out_after));
        // The circuit encodes the output-note asset as YES=1 / NO=2 (the
        // note-scheme asset id), whereas this entrypoint's `asset_out` selector
        // uses YES=0 / NO=1. Convert to the circuit's encoding for the public
        // input so the on-chain verifier's pairing check matches the proof.
        public_inputs.push_back(u32_to_fr_be(&env, asset_out + 1));
        verify(&env, &cfg, symbol_short!("privswap"), &proof_a, &proof_b, &proof_c, public_inputs);

        // Apply the new reserves (map in/out back to yes/no).
        let (new_yes, new_no) = if asset_out == ASSET_YES {
            (reserve_out_after, reserve_in_after)
        } else {
            (reserve_in_after, reserve_out_after)
        };
        set_reserves(&env, new_yes, new_no);

        // Spend the input note.
        mark_nullifier(&env, &nullifier_in);

        // Insert the two output leaves (out + change). The final root is returned.
        merkle::insert(&env, out_commitment.clone());
        let (new_root, _) = merkle::insert(&env, change_commitment.clone());

        accrue_fee(&env, fee);

        env.events().publish(
            (symbol_short!("privswap"), nullifier_in),
            (asset_out, new_root.clone()),
        );

        new_root
    }

    // --------------------------------------------------------------------- //
    // Views
    // --------------------------------------------------------------------- //

    /// Current Merkle root.
    pub fn root(env: Env) -> BytesN<32> {
        merkle::current_root(&env)
    }

    /// Number of leaves inserted so far (next free index).
    pub fn next_index(env: Env) -> u32 {
        merkle::next_index(&env)
    }

    /// Whether `root` is a known (historical or current) root.
    pub fn is_known_root(env: Env, root: BytesN<32>) -> bool {
        merkle::is_known_root(&env, &root)
    }

    /// Whether a nullifier has been spent.
    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        is_nullifier_used(&env, &nullifier)
    }

    /// Current reserves as `(yes, no)`.
    pub fn reserves(env: Env) -> (i128, i128) {
        reserves(&env)
    }

    /// Accrued protocol fees.
    pub fn fees(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Fees).unwrap_or(0)
    }
}

// ------------------------------------------------------------------------- //
// Internal helpers
// ------------------------------------------------------------------------- //

fn config(env: &Env) -> Config {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| panic_with_error(env, Error::NotInitialized))
}

fn require_admin(env: &Env) {
    let cfg = config(env);
    cfg.admin.require_auth();
}

fn is_denied_ref(env: &Env, screening_ref: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Denied(screening_ref.clone()))
        .unwrap_or(false)
}

fn is_nullifier_used(env: &Env, nullifier: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Nullifier(nullifier.clone()))
        .unwrap_or(false)
}

fn mark_nullifier(env: &Env, nullifier: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::Nullifier(nullifier.clone()), &true);
}

fn reserves(env: &Env) -> (i128, i128) {
    let s = env.storage().instance();
    (
        s.get(&DataKey::ReserveYes).unwrap_or(0),
        s.get(&DataKey::ReserveNo).unwrap_or(0),
    )
}

fn set_reserves(env: &Env, yes: i128, no: i128) {
    let s = env.storage().instance();
    s.set(&DataKey::ReserveYes, &yes);
    s.set(&DataKey::ReserveNo, &no);
}

fn accrue_fee(env: &Env, fee: i128) {
    if fee > 0 {
        let s = env.storage().instance();
        let cur: i128 = s.get(&DataKey::Fees).unwrap_or(0);
        s.set(&DataKey::Fees, &(cur + fee));
    }
}

/// Verify a proof against `circuit`, panicking `ProofInvalid` on failure.
fn verify(
    env: &Env,
    cfg: &Config,
    circuit: Symbol,
    a: &BytesN<64>,
    b: &BytesN<128>,
    c: &BytesN<64>,
    public_inputs: Vec<BytesN<32>>,
) {
    let client = verifier::Client::new(env, &cfg.verifier);
    if !client.verify(&circuit, a, b, c, &public_inputs) {
        panic_with_error(env, Error::ProofInvalid);
    }
}

/// Encode a non-negative i128 as a 32-byte big-endian field element.
fn i128_to_fr_be(env: &Env, v: i128) -> BytesN<32> {
    let mut out = [0u8; 32];
    // i128 is 16 bytes big-endian in the low 16 bytes of the 32-byte scalar.
    // Safe: callers guard v >= 0, and the field modulus is far larger than 2^128.
    out[16..].copy_from_slice(&v.to_be_bytes());
    BytesN::from_array(env, &out)
}

/// Encode a u32 as a 32-byte big-endian field element.
fn u32_to_fr_be(env: &Env, v: u32) -> BytesN<32> {
    let mut out = [0u8; 32];
    out[28..].copy_from_slice(&v.to_be_bytes());
    BytesN::from_array(env, &out)
}

fn panic_with_error(env: &Env, e: Error) -> ! {
    soroban_sdk::panic_with_error!(env, e)
}

/// Minimal client for the deployed groth16_verifier contract.
mod verifier {
    use soroban_sdk::{contractclient, BytesN, Env, Symbol, Vec};

    #[contractclient(name = "Client")]
    pub trait Verifier {
        fn verify(
            env: Env,
            circuit: Symbol,
            a: BytesN<64>,
            b: BytesN<128>,
            c: BytesN<64>,
            public_inputs: Vec<BytesN<32>>,
        ) -> bool;
    }
}

#[cfg(test)]
mod test;

# Syzy Shielded — Project Document

> A privacy layer for on-chain prediction markets on Stellar, built with
> zero-knowledge proofs and verified natively inside the Soroban smart-contract host.

**Status:** Proof of Concept · **Network:** Stellar testnet · **Date:** July 2026

---

## 1. Executive summary

Prediction markets are one of the most compelling uses of public blockchains —
but they are also one of the most *privacy-hostile*. When every deposit, trade,
and payout is written to a transparent ledger, anyone can watch your positions,
copy your bets, front-run your trades, or deanonymize you from your betting
history. This transparency is not a minor inconvenience; for many participants it
is the reason they will not use on-chain markets at all.

**Syzy Shielded** is our answer. It is a *shielded pool* — a cryptographic
vault — for prediction-market collateral and outcome tokens on **Stellar**. Users
can deposit funds, trade YES/NO outcome shares against an automated market maker,
and withdraw their winnings, all while keeping the **amounts, balances, and links
between their actions private**. Nothing is trusted to an operator: privacy comes
from mathematics, and every action is authorized by a zero-knowledge proof that is
**verified on-chain** by a Stellar smart contract.

The central technical milestone: **a real zk-SNARK proof, generated off-chain,
verified on Stellar testnet inside the Soroban host** using Stellar's native BN254
elliptic-curve pairing. That is the hard part — and it works. On top of it we then
built the full system: a stateful `shielded_pool` contract (Poseidon Merkle tree +
nullifiers + a YES/NO AMM), a `syzy-shield` CLI, and an optional NestJS relayer
backend — and ran a **complete `shield → private_swap → unshield` flow end-to-end
on testnet**, every step gated by an on-chain proof, every transaction
`successful = true`. The tx hashes are in §6 and `contracts/DEPLOYMENTS.md`.

---

## 2. The problem

### 2.1 Transparency is a liability for markets

On a public blockchain, a prediction market position is fully legible:

- **Your balance is public.** Anyone can see how much collateral you hold.
- **Your trades are public.** Size, direction, and timing are all on the ledger.
- **Your history is linkable.** Every action ties back to one address, so a single
  deanonymization exposes your entire betting record.

This enables **front-running** (bots see your order and jump ahead), **copy-trading
and leakage** (informed traders lose their edge the moment they act), and
**surveillance** (positions on elections, events, or personal outcomes become
public record).

### 2.2 Why existing approaches fall short

- **"Just use a fresh address."** Weak and fragile — funding, gas, and timing
  correlations reconnect the dots almost immediately.
- **Trusted mixers / custodial privacy.** Require trusting an operator who can
  steal, censor, or log everything. That is not privacy; it is a promise.
- **Privacy chains.** Force users off the platform and liquidity they actually want.

We wanted privacy that is **trustless** (no operator can cheat), **on-chain**
(verified by the network, not a server), and **native to Stellar** (where the
market and its liquidity live).

---

## 3. Our solution

Syzy Shielded is a **commitment–nullifier shielded pool** — the same family of
construction that underpins modern privacy protocols — specialized for prediction
markets and adapted to Stellar's cryptographic primitives.

The idea in one paragraph: value is held as secret **notes**, each recorded on-chain
only as a cryptographic **commitment** (a hash that hides its contents). Notes are
accumulated in a **Merkle tree**. To spend a note, you don't reveal *which* note —
you publish a zero-knowledge **proof** that says *"I own some note in this tree and
I'm following the rules,"* along with a one-time **nullifier** that prevents you from
spending it twice. The chain learns that a valid action happened; it never learns
whose, or how much.

### 3.1 What a note is

```
note = Poseidon(asset, amount, ownerPk, rho)
```

- **`asset`** — `0` = COLLATERAL, `1` = YES share, `2` = NO share.
- **`amount`** — the value held.
- **`ownerPk`** — the owner's public key, itself `Poseidon(ownerSk)`.
- **`rho`** — a fresh random secret that makes every note unique and unlinkable.

Only the commitment (the Poseidon hash) is ever published. The four inputs stay
secret with the owner.

### 3.2 How spending stays private but safe

To spend, the owner proves knowledge of a note in the tree and publishes its
**nullifier**:

```
nullifier = Poseidon(ownerSk, rho, leafIndex)
```

The nullifier is **deterministic** for a given note at a given tree position, so
the pool can keep a set of spent nullifiers and reject any repeat — **preventing
double-spends** — without ever learning which commitment the nullifier belongs to.
Crucially, in our circuits the `leafIndex` is *derived from the note's real
position in the Merkle tree*, not supplied freely by the prover. That closes a
subtle attack where a user could mint several different nullifiers for the same
note and spend it multiple times.

### 3.3 The three operations

| Operation | User intent | Kept private | Revealed on-chain |
| --- | --- | --- | --- |
| **Shield** | Deposit collateral into the pool | owner key, note randomness | deposit amount, new commitment |
| **Unshield** | Withdraw to a public address | which note, balance, tree position | Merkle root, nullifier, amount, recipient |
| **Private swap** | Trade collateral ⇄ YES/NO via the AMM | note, trade size, identity | root, input nullifier, output & change commitments, pool reserves, output asset |

Each operation is enforced by its own zero-knowledge circuit, so the rules are
checked *cryptographically* rather than trusted.

---

## 4. What we built

The project is organized as four cooperating layers. All of them exist in this
repository and are tested.

```
        ┌──────────────────┐        ┌─────────────────────┐        ┌────────────────────────┐
 user   │  circom circuits │  proof │   snarkjs / groth16 │  bytes │  Soroban verifier      │
 ─────▶ │  shield/unshield │ ─────▶ │   prove + export    │ ─────▶ │  Groth16Verifier       │
 secret │  private_swap    │        │   (tools/bn254)     │        │  bn254 pairing_check   │
        └──────────────────┘        └─────────────────────┘        └────────────────────────┘
              witness                       proof.json                on-chain: true / false
```

### 4.1 The circuits (the rules of the pool)

Written in **circom 2.1.9**, compiled to R1CS, and proven with **Groth16**. Shared
gadgets live in `circuits/lib/`:

- **`note.circom`** — the note commitment `Poseidon(asset, amount, ownerPk, rho)`.
- **`nullifier.circom`** — derives `ownerPk = Poseidon(ownerSk)` and
  `nullifier = Poseidon(ownerSk, rho, leafIndex)`.
- **`merkle.circom`** — depth-8 Poseidon Merkle inclusion proof with
  bit-constrained path indices. (Depth was reduced from 20 to 8 so the pool's
  on-chain Merkle inserts fit Soroban's per-transaction CPU budget — see §7.)

The three top-level circuits:

| Circuit | Enforces | Non-linear constraints |
| --- | --- | --- |
| `shield` | deposit amount is in range and commitment is well-formed | 546 |
| `unshield` | note membership, correct nullifier, recipient binding | 5,629 |
| `private_swap` | membership, nullifier, value conservation, AMM invariant | 6,474 |

**Soundness we care about.** Zero-knowledge circuits operate over a finite field,
where arithmetic *wraps around* and has no built-in notion of "less than." That is
a trap: a malicious prover could feed in a "negative" (wrapped) value that still
satisfies the equations and **drain the pool**. We defend against this explicitly:

- Every amount and reserve is **range-checked to `[0, 2^64)`** with `Num2Bits(64)`.
  In `private_swap` these checks are *load-bearing* — they turn field subtractions
  like `change = inAmount − amountIn` into genuine integer inequalities, so
  underflow is impossible.
- The AMM enforces **value conservation** (`amountIn + change == inAmount`) and the
  **constant-product invariant**
  (`reserveInBefore·reserveOutBefore == reserveInAfter·reserveOutAfter`).
- The output asset is constrained to be exactly YES or NO.

The circuits are covered by a mocha test suite (`circuits/test/`) that exercises
each gadget and a full **shield → unshield roundtrip**.

### 4.2 The trusted-setup ceremony

Groth16 needs a one-time trusted setup per circuit. We ran a real, honest,
multi-party ceremony:

- **Phase 1 (universal):** the well-known Hermez `powersOfTau28_hez_final_14.ptau`
  (size 2^14 — all three circuits fit comfortably under it).
- **Phase 2 (per-circuit):** two independent contributions each.

Every circuit's `zkey verify` passes, and the verifying-key SHA-256 hashes are
recorded for reproducibility (`circuits/ceremony/CEREMONY.md`). The whole thing is
reproducible with `bash circuits/ceremony/setup.sh`. We are explicit that a broad
public MPC ceremony is a prerequisite for mainnet — this PoC ceremony is
deliberately small.

### 4.3 The on-chain verifier (the milestone)

`contracts/groth16_verifier/` is a `no_std` **Soroban** smart contract, written in
Rust, that verifies a real snarkjs/arkworks **BN254 (alt_bn128) Groth16 proof**
*inside the Stellar host*. It uses Stellar's native BN254 support:
`env.crypto().bn254().pairing_check(...)`.

It checks the standard Groth16 pairing equation in a single pairing check:

```
e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
where vk_x = IC[0] + Σ publicᵢ · IC[i+1]
```

Proof and key data use the **Ethereum-compatible uncompressed big-endian encoding**
(G1 = 64 bytes, G2 = 128 bytes, scalars = 32 bytes), which our tooling
(`tools/bn254-encode.js`) produces from snarkjs output — including the G2
coordinate ordering swap snarkjs requires. The contract's interface is intentionally
minimal:

```rust
pub fn set_vk(env, circuit, vk);                       // register a circuit's verifying key
pub fn verify(env, circuit, a, b, c, public_inputs) -> bool;   // returns true iff proof valid
```

**This is the result that de-risks the whole project.** A real proof, generated by
snarkjs off-chain, was verified on **Stellar testnet** and returned `true`. Details
and transaction hashes are in `contracts/DEPLOYMENTS.md`.

### 4.4 Supporting tooling and probes

- **`tools/`** — the snarkjs → host byte encoder and verifier-fixture emitter, plus
  their tests. This is the glue that makes off-chain proofs consumable on-chain.
- **`contracts/poseidon_probe/`** — **circom-compatible Poseidon computed inside a
  Soroban contract.** We first tried a pure-Rust `ark-bn254` implementation: it
  matched circomlib but compiled to a **~2 MB** wasm that the RPC rejected (413) and
  blew the CPU budget on-chain. We replaced it with a **lean, no-ark, hand-vendored
  BN254 scalar field in Montgomery form (CIOS multiply)** — **~10 KB** wasm, and
  cheap enough to run within Soroban's instruction budget. This exact Poseidon is
  what `shielded_pool` uses to maintain its Merkle tree, and its roots byte-match the
  circuits' (and the CLI's) tree.
- **`fixtures/`** — sample proof / public-input / calldata JSON for reproducible tests.

### 4.5 The shielded-pool state contract

`contracts/shielded_pool/` is the stateful heart: it holds the **YES/NO reserves**,
an **incremental Poseidon Merkle tree** of note commitments, and the **nullifier
set**. Every `shield` / `private_swap` / `unshield` cross-calls the verifier, and
only on a `true` result does it mutate state — insert commitments, advance the root,
record nullifiers, move reserves, transfer collateral. It is deployed to testnet and
covered by Rust `cargo test` (the tests verify a real proof inside the host env).

### 4.6 The CLI and the optional relayer backend

- **`cli/` (`syzy-shield`)** — an encrypted local note store, on-chain event sync to
  rebuild the Merkle tree, snarkjs proof generation, and Stellar submission. Commands:
  `init / markets / shield / swap / unshield / balance / sync`. `npm run e2e` runs the
  whole flow.
- **NestJS `shielded` module** (in the private Syzy backend) — a testnet-gated
  relayer: `/shielded/markets` (market data), `/shielded/relay` (submits a
  proof-gated tx from a **dedicated relayer account**, so the user's address is never
  the tx source), `/shielded/events`, and encrypted **viewing-key** + **screening**
  endpoints. The CLI's `unshield --relayer` drives this path — demonstrated live on
  testnet.

---

## 5. Why Stellar

- **Native BN254 pairing.** Stellar's Soroban host exposes BN254 curve operations,
  which is exactly what a Groth16 verifier needs. We verify proofs *on-chain* with
  a native primitive rather than an expensive hand-rolled arithmetic circuit.
- **Low fees and fast finality.** Prediction markets need cheap, frequent
  interactions; Stellar's economics fit.
- **Real liquidity and assets.** Building where the market lives means users don't
  have to bridge away to get privacy.

---

## 6. End-to-end flow (worked example)

**This flow is not hypothetical — it ran on Stellar testnet** (all `successful = true`):

| Step | Tx hash |
| --- | --- |
| shield | [`10a42d8f…082c475`](https://stellar.expert/explorer/testnet/tx/10a42d8f8a9e84c79c0a0c4c7c37d36839d8128c4e5dd860a9a117780082c475) |
| private_swap | [`4da5f1e6…6e65fac8`](https://stellar.expert/explorer/testnet/tx/4da5f1e6d18817ba270d29b817b1854af5ca1fdc57cb97484372401d6e65fac8) |
| unshield | [`0182ba4b…a692e3c2`](https://stellar.expert/explorer/testnet/tx/0182ba4bd235e72a0ecc8701b21a5ec9aaa82905132e86f03c9c0d3fa692e3c2) |

Pool `CDLT5U3L…`, verifier `CA4HRBVE…`; the withdrawal landed on a fresh,
friendbot-funded address with no on-chain link to the deposit.

**Depositing (shield):**

1. User picks a secret `ownerSk` and random `rho`, sets `amount`, `asset = COLLATERAL`.
2. Computes `commitment = Poseidon(0, amount, Poseidon(ownerSk), rho)`.
3. Generates a `shield` proof that the commitment is well-formed and the amount is in range.
4. Submits the amount + commitment; the contract verifies the proof, pulls the
   collateral, and inserts the commitment into the on-chain Merkle tree.

**Trading (private swap):**

1. User proves ownership of an existing collateral note (Merkle membership + nullifier).
2. The circuit checks value conservation and the constant-product AMM update.
3. New **output** (YES/NO) and **change** (collateral) commitments are published;
   the input nullifier is spent. Amounts and identity stay hidden.

**Withdrawing (unshield):**

1. User proves membership of the note they want to redeem and reveals its nullifier.
2. Public inputs bind the withdrawal `amount` and `recipient` address.
3. The contract verifies, records the nullifier, and pays the collateral out to the
   recipient — optionally relayed so the withdrawal's tx source is not the user.

At no point does the ledger learn the user's balance or link these three actions
to one identity. We ran exactly this flow on testnet; the withdrawal landed on a
brand-new address with no on-chain link to the deposit account (§6 table, and
`contracts/DEPLOYMENTS.md`).

---

## 7. Security posture

We are deliberately honest about what is and isn't done. This is a **proof of
concept**, and it has known, intentional gaps:

| Area | Current state | Needed for production |
| --- | --- | --- |
| Trusted setup | small 2-contributor ceremony | broad public MPC ceremony |
| `set_vk` / admin authorization | minimal PoC gates | proper `require_auth()` review |
| Shielded-pool state | **built + deployed** (root, commitments, nullifier set, AMM) | audit; batched settlement |
| Client / relayer | **built** (CLI + NestJS relayer, live E2E) | production hardening + UX |
| Merkle depth | **8** (256 notes) to fit the CPU budget | higher depth via batching / cheaper hash |
| `unshield` recipient binding | **not enforced in-contract** (CLI keeps it consistent) | bind `recipient_field` to the payout `Address` |
| Per-trade size/direction | leaks via the public reserve delta | batched settlement |

The circuits encode the critical soundness protections (range checks, derived leaf
index, value conservation, AMM invariant). The on-chain verifier was the
eligibility milestone; the full pool + CLI + relayer + end-to-end testnet flow are
now built on top of it. The remaining items are production-hardening, not missing
core pieces.

---

## 8. Roadmap

- [x] circom circuits for shield, unshield, private swap (+ gadget & roundtrip tests)
- [x] Multi-contributor Groth16 ceremony with recorded VK hashes
- [x] BN254 Groth16 verifier contract, tested in the Soroban env
- [x] Verifier deployed to testnet; **real proof verified on-chain**
- [x] Lean, no-ark, circom-compatible Poseidon in-contract (~10 KB wasm)
- [x] **`shielded_pool` state contract** (Merkle root, commitment insertion, nullifier set, AMM) — deployed to testnet
- [x] **`syzy-shield` CLI** + optional NestJS relayer backend
- [x] **Full on-chain end-to-end: shield → private_swap → unshield, all `successful = true`**
- [ ] In-contract `unshield` recipient binding
- [ ] Batched settlement (hide per-trade size/direction) + higher Merkle depth
- [ ] Admin `require_auth` hardening
- [ ] Public MPC trusted-setup ceremony + security audit (mainnet prerequisites)

---

## 9. Summary

We set out to prove that **private, trustless prediction markets on Stellar are
possible today** — not with a custodial mixer or a separate privacy chain, but with
zero-knowledge proofs verified natively on Stellar. We built the full stack: the
circuits that define private deposits, withdrawals, and AMM swaps; an honest
trusted-setup ceremony; the tooling to carry proofs from snarkjs to the chain; a
Soroban contract that **verifies a real Groth16 proof on-chain**; a stateful
`shielded_pool` (Merkle tree + nullifiers + AMM); a `syzy-shield` CLI; and an
optional relayer backend — then ran a **complete `shield → private_swap → unshield`
flow end-to-end on testnet**, each step gated by an on-chain proof.

The core is proven and live on testnet. What remains is production-hardening —
batched settlement to hide per-trade size, in-contract recipient binding, admin
auth review, a public MPC ceremony, and a security audit — all gating any mainnet
deployment.

---

*For build and run instructions, see [`README.md`](README.md). For the deployment
record, see [`contracts/DEPLOYMENTS.md`](contracts/DEPLOYMENTS.md). For the ceremony,
see [`circuits/ceremony/CEREMONY.md`](circuits/ceremony/CEREMONY.md).*

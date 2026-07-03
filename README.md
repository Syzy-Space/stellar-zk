# Syzy Shielded

> A zero-knowledge shielded pool for on-chain prediction markets on Stellar — private deposits, withdrawals, and AMM swaps verified by a BN254 Groth16 verifier running inside the Soroban host.

<p align="left">
  <img alt="Status" src="https://img.shields.io/badge/status-proof--of--concept-orange">
  <img alt="Network" src="https://img.shields.io/badge/network-Stellar%20testnet-blue">
  <img alt="Proof system" src="https://img.shields.io/badge/proofs-Groth16%20%2F%20BN254-8A2BE2">
  <img alt="Circuits" src="https://img.shields.io/badge/circuits-circom%202.1.9-informational">
  <img alt="License" src="https://img.shields.io/badge/license-ISC-lightgrey">
</p>

Syzy Shielded lets users deposit collateral, transact, and swap prediction-market
outcome tokens (YES / NO) **without revealing amounts, balances, or linkage**
between actions. Notes live as Poseidon commitments in a Merkle tree; spends are
authorized by zk-SNARK proofs and protected against double-spend by nullifiers.
Every proof is checked **on-chain** by a Soroban smart contract using Stellar's
native BN254 pairing.

> [!WARNING]
> **This is a proof of concept, not production software.** The trusted setup is a
> small multi-contributor ceremony, the verifier has no admin auth gate, and the
> shielded-pool state contract is not yet wired up. See [Status & roadmap](#status--roadmap)
> and [Security](#security) before using any of this for real value.

---

## Table of contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [The circuits](#the-circuits)
- [The on-chain verifier](#the-on-chain-verifier)
- [Getting started](#getting-started)
- [Deployment](#deployment)
- [Trusted setup ceremony](#trusted-setup-ceremony)
- [Security](#security)
- [Status & roadmap](#status--roadmap)
- [License](#license)

---

## How it works

A **note** is a private record of value:

```
note = Poseidon(asset, amount, ownerPk, rho)
```

where `asset ∈ {0 = COLLATERAL, 1 = YES, 2 = NO}`, `ownerPk = Poseidon(ownerSk)`,
and `rho` is a per-note random secret. Notes are inserted as leaves into a
depth-20 Poseidon Merkle tree. To spend a note, a user proves — in zero knowledge —
that they know a note in the tree and reveal only its **nullifier**:

```
nullifier = Poseidon(ownerSk, rho, leafIndex)
```

The nullifier is deterministic per note and per tree position, so the pool can
reject a second spend without ever learning which note was consumed. Three
operations are supported, each backed by its own circuit:

| Operation | What stays private | What becomes public |
| --- | --- | --- |
| **Shield** (deposit) | owner key, note secret | deposit amount, output commitment |
| **Unshield** (withdraw) | note, balance, tree position | Merkle root, nullifier, withdraw amount, recipient |
| **Private swap** (AMM) | note, trade size, owner | root, input nullifier, output & change commitments, reserves, output asset |

## Architecture

```
        ┌──────────────────┐        ┌─────────────────────┐        ┌────────────────────────┐
 user   │  circom circuits │  proof │   snarkjs / groth16 │  hex   │  Soroban verifier      │
 ─────▶ │  shield/unshield │ ─────▶ │   prove + export    │ ─────▶ │  Groth16Verifier       │
 secret │  private_swap    │        │   (tools/bn254)     │        │  bn254 pairing_check   │
        └──────────────────┘        └─────────────────────┘        └────────────────────────┘
              witness                       proof.json                on-chain: true / false
```

1. **Circuits** (`circuits/`) express the spend rules in circom and compile to R1CS.
2. **Ceremony** (`circuits/ceremony/`) produces proving/verifying keys via Groth16 setup.
3. **Prover** uses snarkjs to generate a proof; `tools/bn254-encode.js` converts the
   snarkjs output into the Ethereum-compatible big-endian byte encoding the host expects.
4. **Verifier** (`contracts/groth16_verifier/`) checks the proof on Stellar with
   `env.crypto().bn254().pairing_check(...)`.

## Repository layout

```
.
├── circuits/                 # circom sources, tests, and the trusted-setup ceremony
│   ├── shield.circom         # deposit circuit
│   ├── unshield.circom       # withdraw circuit (Merkle inclusion + nullifier)
│   ├── private_swap.circom   # AMM swap circuit (constant-product, value conservation)
│   ├── lib/                  # reusable gadgets: note, nullifier, merkle
│   ├── test/                 # mocha + circom_tester specs
│   ├── scripts/              # fixture export helpers
│   └── ceremony/             # Powers of Tau + per-circuit phase-2, see CEREMONY.md
├── contracts/                # Soroban (Rust / no_std) workspace
│   ├── groth16_verifier/     # BN254 Groth16 verifier contract + on-chain test
│   ├── poseidon_probe/       # de-risking probe: circom-compatible Poseidon in-contract
│   ├── scripts/              # make-invoke-args.js (fixture → CLI args)
│   └── DEPLOYMENTS.md        # testnet deployment record
├── tools/                    # snarkjs → host byte encoders + verifier fixtures
├── fixtures/                 # sample proof / public / calldata JSON
└── package.json              # circuit test runner (mocha)
```

## The circuits

All circuits use `circom 2.1.9` and circomlib's Poseidon, with a fixed Merkle
depth of **20**. Key soundness properties enforced in-circuit:

- **Range checks.** Amounts and reserves are constrained to `[0, 2^64)` via
  `Num2Bits(64)`. In `private_swap` these are *load-bearing*: field arithmetic has
  no inherent ordering, so without bounds a prover could wrap a negative value past
  the field modulus and drain the pool. Forcing subtractions like `change` and
  `reserveOutAfter` into range turns them into real integer inequalities.
- **Double-spend resistance.** `leafIndex` is *derived* from the bit-constrained
  Merkle `pathIndices`, not taken as a free input — so a note can only be nullified
  for its actual tree position.
- **Value conservation & AMM invariant.** `private_swap` enforces
  `amountIn + change == inAmount`, moves reserves by the trade, and asserts the
  constant product `reserveInBefore·reserveOutBefore == reserveInAfter·reserveOutAfter`.

| Circuit | Non-linear constraints |
| --- | --- |
| `shield` | 546 |
| `unshield` | 5,629 |
| `private_swap` | 6,474 |

All three fit comfortably under `2^14`, so a single Powers-of-Tau of size 2^14 covers them.

## The on-chain verifier

`contracts/groth16_verifier` is a `no_std` Soroban contract that verifies a real
snarkjs/arkworks BN254 (alt_bn128) Groth16 proof. Encoding is Ethereum-compatible
uncompressed big-endian:

- **G1** = `be(x) || be(y)` (64 bytes)
- **G2** = `be(x_c1) || be(x_c0) || be(y_c1) || be(y_c0)` (128 bytes)
- **Fr** = 32-byte big-endian scalar

It checks the Groth16 pairing equation

```
e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1,   vk_x = IC[0] + Σ publicᵢ · IC[i+1]
```

in one `pairing_check`. The public interface:

```rust
pub fn set_vk(env: Env, circuit: Symbol, vk: Vkey);
pub fn verify(
    env: Env,
    circuit: Symbol,
    a: BytesN<64>,
    b: BytesN<128>,
    c: BytesN<64>,
    public_inputs: Vec<BytesN<32>>,
) -> bool;
```

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [circom](https://docs.circom.io/getting-started/installation/) 2.1.9+
- [Rust](https://www.rust-lang.org/tools/install) stable with the `wasm32-unknown-unknown` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli) (for deployment)

### Install & test the circuits

```bash
npm install
npm test          # mocha circuits/test/**/*.spec.js
```

The suite exercises each gadget (`note`, `nullifier`, `merkle`), each circuit,
and a full shield → unshield roundtrip.

### Build & test the contracts

```bash
cd contracts
cargo test        # runs the on-chain proof-verification test in the Soroban env
cargo build --target wasm32-unknown-unknown --release
```

`cargo test` verifies a real Groth16 proof end-to-end inside the Soroban host
environment — no network required.

## Deployment

The verifier is deployed on **Stellar testnet**. A real shield proof has been
verified on-chain (`verify` returned `true`).

| Field | Value |
| --- | --- |
| Network | testnet |
| Contract ID | `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X` |
| Wasm hash | `5ea130ee34537525338c4107da45be0be9e9bc0627ab0e79fd452ccdfa662902` |
| `verify` result | `true` |

Full deployment record, transaction hashes, and a [Stellar Expert](https://stellar.expert/explorer/testnet)
link are in [`contracts/DEPLOYMENTS.md`](contracts/DEPLOYMENTS.md).

To reproduce an invocation, `contracts/scripts/make-invoke-args.js` converts a
proof/vkey fixture into CLI args:

```bash
cd contracts
node scripts/make-invoke-args.js
stellar contract invoke --id <CID> --source <account> --network testnet \
  -- verify --circuit shield --a <hex> --b <hex> --c <hex> --public_inputs '<json-array>'
```

## Trusted setup ceremony

Groth16 requires a per-circuit trusted setup. This PoC uses:

- **Phase 1 (universal):** the Hermez `powersOfTau28_hez_final_14.ptau` (2^14).
- **Phase 2 (per-circuit):** two independent contributions per circuit.

Reproduce with `bash circuits/ceremony/setup.sh`. Verifying-key hashes and
`zkey verify` results are recorded in [`circuits/ceremony/CEREMONY.md`](circuits/ceremony/CEREMONY.md).

> A broad public MPC ceremony is a prerequisite for any mainnet use.

## Security

This is research-grade software with known, deliberate gaps:

- **Trusted setup** is a small multi-contributor ceremony, not a public MPC.
- **No auth gate.** `set_vk` has no admin `require_auth()` — anyone can set/rotate
  a verifying key. Hardening must add an admin check before mainnet.
- **No state contract yet.** The shielded-pool contract that tracks the Merkle
  root, accepts commitments, and records nullifiers is not implemented here — the
  verifier is the eligibility milestone.

Do not use with funds you are not prepared to lose. Responsible disclosure of any
issues is welcomed via the issue tracker.

## Status & roadmap

- [x] circom circuits: shield, unshield, private swap (+ gadget tests)
- [x] Multi-contributor Groth16 ceremony with recorded VK hashes
- [x] BN254 Groth16 verifier contract, tested in the Soroban env
- [x] Verifier deployed to testnet; real proof verified on-chain
- [x] Poseidon-in-contract de-risking probe
- [ ] Shielded-pool state contract (Merkle root, commitments, nullifier set)
- [ ] Admin auth gate on `set_vk`
- [ ] Public MPC trusted-setup ceremony
- [ ] End-to-end client / relayer

## License

ISC. See [`package.json`](package.json).

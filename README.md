# Syzy Shielded

> A zero-knowledge shielded pool for on-chain prediction markets on Stellar —
> private deposits, AMM swaps, and withdrawals, each gated by a BN254 Groth16
> proof verified **inside the Soroban host**.

<p align="left">
  <img alt="Status" src="https://img.shields.io/badge/status-proof--of--concept-orange">
  <img alt="Network" src="https://img.shields.io/badge/network-Stellar%20testnet-blue">
  <img alt="Proof system" src="https://img.shields.io/badge/proofs-Groth16%20%2F%20BN254-8A2BE2">
  <img alt="Circuits" src="https://img.shields.io/badge/circuits-circom%202.1.9-informational">
  <img alt="License" src="https://img.shields.io/badge/license-ISC-lightgrey">
</p>

> **Private traders. Public price discovery. Verified on Stellar.**

**Syzy Shielded** is a shielded pool for prediction markets: you deposit
collateral, swap it into YES / NO outcome tokens through a constant-product AMM,
and later withdraw — all while your **identity** and the **link between your
deposit and your withdrawal** stay hidden, *and the AMM still produces a public
price everyone can see*. Value lives as Poseidon note commitments in an on-chain
Merkle tree; spends are authorized by zk-SNARK proofs and protected against
double-spend by nullifiers.

It is the privacy layer for **[Syzy](https://syzy.space)**, a live prediction
market on Stellar **mainnet**. This repo is the **testnet proof-of-concept** of
that layer — see [Honest scope](#honest-scope-this-is-a-hackathon-poc) for
exactly what is real, mocked, and testnet-only.

📄 **Deeper write-up:** [`DOC.md`](DOC.md) (problem, design, and what we built) ·
**deployment record:** [`contracts/DEPLOYMENTS.md`](contracts/DEPLOYMENTS.md) ·
**demo script:** [`demo-video-script.md`](demo-video-script.md).

### What the ZK is doing here (load-bearing, not decorative)

Every `shield`, `private_swap`, and `unshield` is **gated by an on-chain Groth16
proof**: the `shielded_pool` contract cross-calls the verifier contract, which
runs the BN254 pairing check (`env.crypto().bn254().pairing_check(...)`) and
reverts the transaction if the proof does not verify. The chain confirms the
spend is *valid* — the note exists in the tree, value is conserved, the AMM
invariant holds, the nullifier is fresh — **without learning who you are or which
deposit funded which withdrawal**. Remove the proof and the pool has no way to
authorize a spend without revealing the note; the ZK verification *is* the
authorization mechanism.

---

## Live on Stellar testnet

A complete `shield → private_swap → unshield` flow ran on testnet through the
`syzy-shield` CLI. Each step generated a real Groth16 proof off-chain and landed
a real proof-gated transaction on-chain (all `successful = true`).

| Thing | ID / hash |
| --- | --- |
| **Verifier contract** | [`CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X`](https://stellar.expert/explorer/testnet/contract/CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X) |
| **Pool contract** (depth-8) | [`CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA`](https://stellar.expert/explorer/testnet/contract/CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA) |
| **1. shield** tx | [`10a42d8f…082c475`](https://stellar.expert/explorer/testnet/tx/10a42d8f8a9e84c79c0a0c4c7c37d36839d8128c4e5dd860a9a117780082c475) |
| **2. private_swap** tx | [`4da5f1e6…6e65fac8`](https://stellar.expert/explorer/testnet/tx/4da5f1e6d18817ba270d29b817b1854af5ca1fdc57cb97484372401d6e65fac8) |
| **3. unshield** tx | [`0182ba4b…a692e3c2`](https://stellar.expert/explorer/testnet/tx/0182ba4bd235e72a0ecc8701b21a5ec9aaa82905132e86f03c9c0d3fa692e3c2) |

The withdrawal landed on a **brand-new, friendbot-funded address**
`GBMB355KG5ILPOLTBG7VRDDBUULBJLOJA37UFOSAGLRW4G2QFCINDNTB` (ended with
`10000.075` XLM = 10000 friendbot + 0.075 unshielded change). It was **not**
funded by, and has **no on-chain payment or account-creation link to**, the
deposit account. The shielded pool is the only common counterparty — the
deposit↔withdrawal link is hidden.

The swap used an exact integer constant product (reserves seeded 1,000,000 /
1,000,000): `amountIn = 250,000`, reserves → 1,250,000 / 800,000,
`amountOut = 200,000` YES, `change = 750,000` (`1e6·1e6 == 1.25e6·8e5 = 1e12`).

Full deployment record + tx hashes: [`contracts/DEPLOYMENTS.md`](contracts/DEPLOYMENTS.md).
CLI write-up: [`cli/E2E.md`](cli/E2E.md).

---

## How it works

A **note** is a private record of value:

```
note      = Poseidon(asset, amount, ownerPk, rho)      asset ∈ {0=COLLATERAL, 1=YES, 2=NO}
ownerPk   = Poseidon(ownerSk)
nullifier = Poseidon(ownerSk, rho, leafIndex)
```

Notes are inserted as leaves into an on-chain Poseidon Merkle tree. To spend a
note you prove, in zero knowledge, that you know a note in the tree and reveal
only its **nullifier** — deterministic per note and per tree position — so the
pool can reject a second spend without ever learning which note was consumed.

| Operation | What stays private | What becomes public |
| --- | --- | --- |
| **shield** (deposit) | owner key, note secret | deposit amount, output commitment |
| **private_swap** (AMM) | note, owner, tree position | root, input nullifier, out/change commitments, reserves, output asset |
| **unshield** (withdraw) | note, balance, tree position | root, nullifier, withdraw amount, recipient |

## Architecture

```
       ┌───────────────────┐   witness   ┌──────────────────┐   proof(hex)  ┌──────────────────────────┐
 user  │  circom circuits  │ ──────────▶ │ snarkjs Groth16  │ ────────────▶ │  Soroban contracts        │
 secret│  shield / unshield│             │  prove + bn254   │               │  shielded_pool ──► verifier│
       │  private_swap     │             │  byte-encode     │               │  (Merkle+nullifiers+AMM)  │
       └───────────────────┘             └──────────────────┘               │  bn254 pairing_check      │
                                                                            └──────────────────────────┘
```

1. **Circuits** (`circuits/`) express the spend rules in circom → R1CS.
2. **Ceremony** (`circuits/ceremony/`) produces Groth16 proving/verifying keys.
3. **CLI** (`cli/`, `syzy-shield`) manages notes + an encrypted local store,
   syncs the Merkle tree from on-chain events, generates proofs with snarkjs, and
   submits transactions.
4. **`shielded_pool`** (`contracts/shielded_pool/`) holds the YES/NO reserves,
   the incremental Poseidon Merkle tree, and the nullifier set; on every op it
   cross-calls the **`groth16_verifier`** contract, which runs the BN254 pairing
   check on-chain.

## Repository layout

```
.
├── circuits/               # circom sources, gadget/circuit tests, Groth16 ceremony
│   ├── shield.circom        unshield.circom   private_swap.circom
│   ├── lib/                # note, nullifier, merkle gadgets
│   └── ceremony/           # Powers of Tau + per-circuit phase-2 (see CEREMONY.md)
├── contracts/              # Soroban (Rust / no_std) workspace
│   ├── groth16_verifier/   # BN254 Groth16 verifier (on-chain pairing_check)
│   ├── shielded_pool/      # reserves + Poseidon Merkle tree + nullifiers + AMM
│   ├── poseidon_probe/     # de-risking probe: circom-compatible Poseidon in-contract
│   ├── scripts/            # deploy-pool-testnet.sh, make-invoke-args.js
│   └── DEPLOYMENTS.md      # canonical testnet deployment record
├── cli/                    # syzy-shield: note store, prover, chain client, E2E.md
├── tools/                  # snarkjs → host byte encoders + vkey emitters
└── fixtures/               # sample proof / public / calldata JSON
```

## Circuit soundness (the parts that keep the pool safe)

All circuits use `circom 2.1.9`, circomlib Poseidon, and Merkle depth **8**.

- **Range checks (load-bearing).** Amounts and reserves are constrained to
  `[0, 2^64)` via `Num2Bits(64)`. Field arithmetic has no inherent ordering, so
  without bounds a prover could wrap a negative value past the field modulus
  (e.g. `amountOut > reserveOut`) and drain the pool while still satisfying every
  field equality. Forcing the subtractions `change` and `reserveOutAfter` into
  range turns them into real integer inequalities.
- **Double-spend resistance.** `leafIndex` is *derived* from the bit-constrained
  Merkle `pathIndices`, **not** taken as a free input — so a note can only ever be
  nullified for its actual tree position.
- **Value conservation + AMM.** `private_swap` enforces
  `amountIn + change == inAmount`, moves reserves by the trade, and asserts the
  exact constant product `reserveInBefore·reserveOutBefore == reserveInAfter·reserveOutAfter`.

## Run it

```bash
# 0. clone
git clone https://github.com/Syzy-Space/stellar-zk.git && cd stellar-zk

# 1. install deps + run the ZK circuit tests (mocha + circom_tester)
npm install
npx mocha 'circuits/test/**/*.spec.js' --timeout 300000 --exit

# 2. build the circuits + run the trusted-setup ceremony (produces .zkey / vkeys)
bash circuits/ceremony/setup.sh

# 3. build + test the Soroban contracts (verifies a real proof inside the host)
cd contracts && cargo test && cd ..

# 4. deploy ONE fresh depth-8 pool, wire the verifier, set all 3 VKs, seed reserves
bash contracts/scripts/deploy-pool-testnet.sh     # prints the pool contract id

# 5. run the whole shielded flow end-to-end in one shot (each step lands a
#    proof-gated tx; prints the three tx hashes + Stellar Expert links)
cd cli && npm install
npm run e2e                                        # == bash scripts/e2e-testnet.sh
```

Or drive the steps by hand (same flow, explicit):

```bash
cd cli && npm install && npm run build
export SYZY_POOL_ID=<pool-id-from-step-4>          # or use the default in config.ts
node dist/index.js init                            # create + friendbot-fund a wallet
node dist/index.js shield   --amount 1000000
node dist/index.js sync                            # rebuild leaf mirror from on-chain events
node dist/index.js swap     --side yes --amount 250000
node dist/index.js sync
node dist/index.js unshield --amount 750000 --to new   # fresh, unlinked recipient
```

The pool/verifier/SAC defaults in [`cli/src/config.ts`](cli/src/config.ts) point
at a live deployment, so the individual steps above work against it for a *first*
run. **Re-running the full flow needs a FRESH pool**, because the CLI
reconstructs only its OWN leaves: `private_swap` output leaves are never emitted
in any contract event, so the local append-ordered mirror is the sole record of
them and the client cannot rebuild another run's dirtied tree (documented PoC
limitation). For that reason `npm run e2e` deploys a fresh depth-8 pool at the
top of each run (via `contracts/scripts/deploy-pool-testnet.sh`) and points the
CLI at it. `npm run e2e` uses `npx tsx` and needs no separate build step. Full
walk-through: [`cli/E2E.md`](cli/E2E.md).

Proof generation runs **locally**: the note secrets and owner keys never leave
the client. Submission defaults to direct testnet submit; an **optional relayer /
NestJS backend module** can instead relay txs, serve market data, and store
**encrypted viewing keys** for compliance-friendly auditability — none of it is
required to run the flow above.

## Backend integration (relayer path)

The CLI can go **through the Syzy backend** instead of submitting Soroban txs
itself. This is what lets a withdrawal land on-chain **without the user's address
ever being the tx source** — the backend's dedicated relayer account is.

### What the CLI adds

- [`cli/src/api.ts`](cli/src/api.ts) — a typed client for the backend
  `/shielded/*` routes (`SYZY_BACKEND_URL`, default `http://localhost:7788`):
  `getMarkets()`, `relay()`, `getEvents()`, `getScreening()`, `postViewingKey()`,
  `getAudit()`, plus `buildRelayPayload()` (the single source of truth for the
  `/shielded/relay` request shape).
- `syzy-shield markets` — prints the projected market list from the **running
  backend** (`GET /shielded/markets`).
- `unshield --relayer` — the relayer path. `unshield` is fully proof-gated and
  needs **no user `require_auth`**, so the CLI builds the pool `unshield`
  invocation as a tx whose **SOURCE is the relayer account**
  ([`SYZY_RELAYER_PUBLIC`](cli/src/config.ts)), prepares it (simulate + assemble
  the Soroban footprint), serializes it **unsigned** to XDR, and POSTs it to
  `POST /shielded/relay`. The backend re-validates it is a single
  pool-only invocation, **signs with its own `SHIELDED_RELAYER_SECRET`**,
  submits, and returns the tx hash. The default (no `--relayer`) still submits
  directly from the user wallet.

  > `shield` and `private_swap` relay builders exist too, but the clean,
  > fully-relayed case is `unshield` (no user auth entry). Relayed `shield`
  > would pull collateral from the relayer's own balance.

### Run the backend + relayer flow

```bash
# 1. Backend (in syzy-be), testnet mode. Put the shielded config in .env.local
#    (gitignored):
#   SHIELDED_ENABLED=true
#   SHIELDED_NETWORK=testnet
#   SHIELDED_POOL_CONTRACT=CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA
#   GROTH16_VERIFIER_CONTRACT=CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X
#   SHIELDED_RELAYER_SECRET=<a FUNDED testnet secret key>   # friendbot-fund it
#
# The relayer prepares/simulates against STELLAR_RPC_URL. If the repo's committed
# .env points at MAINNET, EXPORT the testnet Stellar vars when launching so the
# shell env wins over dotenv (NestJS ConfigModule does not reliably override a
# process.env value that network.config reads directly) — otherwise the relay
# simulates the testnet pool against mainnet RPC and fails with
# `Error(Storage, MissingValue)` (the contract doesn't exist on mainnet):
cd syzy-be && npm run build
STELLAR_RPC_URL="https://soroban-testnet.stellar.org" \
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
STELLAR_CONTRACT_ID="CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA" \
STELLAR_NATIVE_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" \
  node dist/main                                     # boots on :7788

# 2. CLI → backend. Point at the backend + the relayer's PUBLIC key.
cd cli
export SYZY_BACKEND_URL=http://localhost:7788
export SYZY_RELAYER_PUBLIC=<G... public key of the backend's SHIELDED_RELAYER_SECRET>

npx tsx src/index.ts markets                          # reads /shielded/markets
npx tsx src/index.ts shield   --amount 300000        # create a note to withdraw
npx tsx src/index.ts unshield --to new --relayer     # CLI → /shielded/relay → chain
```

> Run the backend with a **stable** process (`node dist/main`), not
> `start:dev` watch mode — a hot-reload landing mid-`/shielded/relay` will drop
> the request.

### Demonstrated (live testnet)

```text
$ syzy-shield markets
Markets from http://localhost:7788/shielded/markets:
- GASCMDTRUZKXXFEEEVYR7PCWMASHVU7XNTAV2GN7MPQ3SYG4LIFSJA5E
    Referral fee flows?
    yes=5000 no=5000 price=0.5
- GC3MJXUIZKZJTITOMPOZKYDTF4MYFB5U4IY4KGD5Q2GNZGFFZWNR4TFC
    L2 fee flows?
    yes=5000 no=5000 price=0.5
  ... (live, seeded from the backend's MarketsService)
```

Relayed `unshield` (CLI → `POST /shielded/relay` → backend signs + submits):

- **Relay tx hash:** `4bbd6479f79d1c121118bf817a6061436a60e45f088071f04913cb795f0abf53`
- **Stellar Expert:** https://stellar.expert/explorer/testnet/tx/4bbd6479f79d1c121118bf817a6061436a60e45f088071f04913cb795f0abf53
- **Tx source = relayer** `GADH7NJTG63JMCLTCYV5UO6P2SL4IBCTVI5R54PZ3K77NK23YEYXAZLJ`
  (the user's wallet is **not** the source), confirming the relayer model.

## Honest scope (this is a hackathon PoC)

The hackathon asks for honesty; here is exactly what is and isn't real:

- **Testnet only.** Any mainnet use is gated behind a security audit and a broad
  public trusted-setup ceremony. Neither has happened.
- **Merkle depth reduced to 8 (256 notes).** One on-chain Poseidon2 permutation
  costs ≈19M instructions; a depth-20 `private_swap` does ~40 inserts ≈765M,
  which blows past Soroban's ~400M-instruction per-transaction budget. Depth 8
  (16 inserts, ≈306M) fits. This is a **PoC capacity limit**, not a design limit —
  a production version needs batching / a cheaper in-circuit hash to raise depth.
- **Per-trade size and direction are visible.** Identity and the deposit↔withdrawal
  linkage **are** hidden. But a swap publishes the reserve deltas
  (`reserveIn/OutBefore/After`) and the output asset, so the traded amount and
  direction of *that individual swap* leak from the public reserve movement. Full
  size/direction hiding needs batched settlement (many trades share one reserve
  delta) — a production circuit, not built here.
- **`recipient_field` binding gap.** On `unshield`, the contract does **not**
  cryptographically bind the proof's `recipient_field` public input to the payout
  `Address`. The CLI derives both from the same key and keeps them consistent, so
  the demo is sound — but a production contract **must** enforce the binding
  (otherwise a relayer could redirect the payout). Documented in
  [`cli/E2E.md`](cli/E2E.md).
- **Trusted setup is small.** A real multi-contributor Groth16 phase-2 ceremony
  (2 contributors, recorded in
  [`circuits/ceremony/CEREMONY.md`](circuits/ceremony/CEREMONY.md)), **not** a
  broad public MPC. Mainnet requires the latter.
- **Deposit screening is illustrative.** `shield` carries a `screening_ref` and
  the pool rejects a denylisted ref, but the denylist is a stub demonstrating the
  hook — not a real compliance / sanctions-screening integration.
- **No admin auth hardening.** `set_vk` and fee-withdrawal admin paths are
  minimal PoC gates; production needs proper `require_auth` review.
- **Single self-contained pool.** One YES/NO market with seeded reserves; no
  market factory, oracle resolution, or settlement is implemented in this repo.
- **Provenance of the circuits.** The Circom circuit *designs* (note scheme,
  nullifier, Merkle, AMM) predate this hackathon — they are part of Syzy's private
  R&D. The **hackathon work** is everything that makes them verify and settle on
  Stellar: the Soroban BN254 Groth16 verifier, the `shielded_pool` contract, the
  depth-8 re-tuning + ceremony, the testnet deployment, the `syzy-shield` CLI, and
  the full on-chain end-to-end flow.

## Status

- [x] circom circuits: shield, unshield, private_swap (+ gadget tests) — depth 8
- [x] Multi-contributor Groth16 ceremony with recorded VK hashes
- [x] BN254 Groth16 verifier contract, tested in the Soroban env + deployed to testnet
- [x] `shielded_pool`: reserves, Poseidon Merkle tree, nullifiers, AMM — deployed to testnet
- [x] `syzy-shield` CLI: note store, sync, prover, chain client
- [x] **Full on-chain E2E: shield → private_swap → unshield, all `successful=true`**
- [ ] Batched settlement to hide per-trade size/direction
- [ ] Higher Merkle depth (cheaper in-circuit hash / batching)
- [ ] Public MPC trusted-setup ceremony + security audit (mainnet prerequisites)

## Team

Built by **[Morca Labs](https://syzy.space)** — a Web3 & AI studio based in
Vietnam, and the team behind [Syzy](https://syzy.space), a live prediction market
on Stellar mainnet. Syzy Shielded is our ZK privacy layer for it.

## License

ISC. See [`package.json`](package.json).

---

_Built by **Morca Labs** for the Stellar Hacks "Real-World ZK" hackathon._

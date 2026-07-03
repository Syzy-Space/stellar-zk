# Syzy Shielded — Testnet End-to-End (shield → private_swap → unshield)

A full private prediction-market flow executed against the deployed shielded
pool on **Stellar testnet**, with each of the three transactions carrying a real
snarkjs BN254 Groth16 proof **verified on-chain** by the `groth16_verifier`
contract via the host's `bn254().pairing_check`. This is the hackathon demo
evidence: a shield, a private swap, and an unshield to a brand-new address that
has **no on-chain link** to the deposit account.

## The three transactions (2026-07-04)

| Step | Tx hash | Stellar Expert | Status |
| --- | --- | --- | --- |
| **shield** (0.1 XLM → note) | `10a42d8f8a9e84c79c0a0c4c7c37d36839d8128c4e5dd860a9a117780082c475` | https://stellar.expert/explorer/testnet/tx/10a42d8f8a9e84c79c0a0c4c7c37d36839d8128c4e5dd860a9a117780082c475 | SUCCESS |
| **private_swap** (YES) | `4da5f1e6d18817ba270d29b817b1854af5ca1fdc57cb97484372401d6e65fac8` | https://stellar.expert/explorer/testnet/tx/4da5f1e6d18817ba270d29b817b1854af5ca1fdc57cb97484372401d6e65fac8 | SUCCESS |
| **unshield** (→ fresh addr) | `0182ba4bd235e72a0ecc8701b21a5ec9aaa82905132e86f03c9c0d3fa692e3c2` | https://stellar.expert/explorer/testnet/tx/0182ba4bd235e72a0ecc8701b21a5ec9aaa82905132e86f03c9c0d3fa692e3c2 | SUCCESS |

## Contracts

| Field | Value |
| --- | --- |
| Pool (depth-8) | `CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA` |
| Verifier | `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X` |
| XLM SAC (collateral) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

## Unlinkability (the point of the demo)

| Account | Address | Note |
| --- | --- | --- |
| **Deposit** (shield source) | `GCTFKIEFI4HTCLPTNSE2C7LZT2A47SARD4UWXF7PW7PUE33GJB4KJQYC` | funded the 0.1 XLM shield |
| **Fresh withdrawal** (unshield recipient) | `GBMB355KG5ILPOLTBG7VRDDBUULBJLOJA37UFOSAGLRW4G2QFCINDNTB` | received the 0.075 XLM change payout |

The deposit and withdrawal accounts share **no transaction, signature, or
memo**. The link between them exists only inside the shielded pool as spent
nullifiers and note commitments; on the public ledger the withdrawal address
appears as a friendbot-funded account that received a transfer from the pool
contract. Post-run the fresh address held `10000.075 XLM` (10000 from friendbot
+ 0.075 = 750000 stroops from the shielded change note).

## Exact swap values — integer constant product (enforced EXACTLY by the circuit)

Reserves started `1000000 / 1000000` (k = 1e12). `--side yes` ⇒ the trader pays
into the **NO** leg and receives the **YES** leg.

```
amountIn         = 250000
reserveIn_before = 1000000 (NO)      reserveOut_before = 1000000 (YES)
reserveIn_after  = 1000000 + 250000 = 1250000
reserveOut_after = 1e12 / 1250000   = 800000
amountOut        = 1000000 - 800000  = 200000
constant product : 1000000 * 1000000 == 1250000 * 800000   (both 1e12)  ✓
change (collateral) = 1000000 - 250000 = 750000
```

The circuit asserts `reserveInBefore*reserveOutBefore === reserveInAfter*reserveOutAfter`
with strict field equality, so amountIn was chosen so `k` is divisible by
`reserveIn_after` (integer amountOut). After the swap the pool reported reserves
`800000 / 1250000` (YES / NO), confirming on-chain application.

Result: one **YES** note of `200000`, one **change collateral** note of `750000`.
The change note was then unshielded to the fresh address.

## `recipient_field` handling

The `unshield` circuit binds a public `recipient` field element but the contract
does **not** enforce `recipient_field ↔ recipient` (documented PoC gap). The CLI
derives `recipient_field = <recipient raw ed25519 pubkey bytes> mod r` and passes
the identical value into both the proof and the contract call, so the two agree.

## How sync works (events, with a local mirror)

`sync` reconstructs the leaf order from the pool's **`shield` contract events**
(`getEvents` over RPC), rebuilds the depth-8 Merkle tree, and fixes each local
note's true `leafIndex` by matching recomputed commitments. Merkle paths for
spends authenticate against this tree; on every run the local root matched the
on-chain `root()` exactly. **PoC limitation:** `private_swap` output leaves are
not emitted as shield events, so between a swap and the next shield the leaf
mirror is maintained locally (append-in-submission-order); this is sufficient
because only our client transacts in the demo. The encrypted note store
(`cli/src/notes.ts`, AES-256-GCM) additionally implements commitment-list-based
`sync`/`treeAndPath` and is unit-tested.

## Reproduce

```
# 1. Deploy a fresh depth-8 pool + wire all three VKs (shield/unshield/privswap):
bash contracts/scripts/deploy-pool-testnet.sh
# 2. Point cli/src/config.ts SYZY_POOL_ID at the new pool id.
# 3. Run the full flow (prints the three tx hashes + links):
cd cli && npm run e2e     # == bash scripts/e2e-testnet.sh
```

## Engineering notes found during bring-up

1. **`private_swap` assetOut public input** — the circuit encodes the output
   asset as the note-scheme id (YES=1, NO=2), but the entrypoint's `asset_out`
   selector uses YES=0/NO=1. The contract now pushes `asset_out + 1` as the
   public input (was pushing the raw selector; the mock verifier ignored it, the
   real on-chain verifier rejected it).
2. **Soroban CPU budget** — the pool's on-chain Poseidon Merkle insert is very
   expensive (~18M instructions/hash). At depth 20 a single shield insert (~370M)
   + the pairing verify neared the tx budget, and private_swap's TWO inserts blew
   past it (`Budget/ExceededLimit`). Fixed by (a) caching the Merkle `zeros`
   array at init instead of recomputing 20 hashes per insert, and (b) reducing
   the tree **depth 20 → 8** across circuits/contract/client (re-ran the Groth16
   ceremony + re-emitted vkeys).
3. **VK circuit-symbol mismatch** — the pool calls the verifier with
   `symbol_short!("privswap")`, but the deploy script registered the VK under
   `private_swap`; the missing-VK unwrap trapped verify with
   `WasmVm/UnreachableCodeReached`. The deploy script now registers under
   `privswap`.
4. **Ceremony regenerates every zkey** — re-running the ceremony regenerated the
   `shield` zkey too, so the on-chain shield VK had to be refreshed or shield
   verify returned `false` (Contract #3). The deploy script now sets all three
   VKs.

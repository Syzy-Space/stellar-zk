# Syzy Shielded — Contract Deployments (testnet)

> **Canonical, live deployment.** There is exactly ONE live pool. Earlier pools
> deployed during bring-up are listed at the bottom as **SUPERSEDED** — do not
> use them. `cli/src/config.ts`, `cli/E2E.md`, and this file all reference the
> canonical pool `CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA`.

| Role | Contract ID |
| --- | --- |
| **Pool** (`shielded_pool`, depth-8) | `CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA` |
| **Verifier** (`groth16_verifier`) | `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X` |
| **Collateral SAC** (XLM) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Deployer (`shielded-deployer`) | `GCRBJRJPSUWLYL4LNOD7UXFM5I3QKR5HE3PTKDTOFTSEFCLBQADMFV2L` |

Live reserves after the E2E swap (queried on-chain): `reserves() = [800000, 1250000]`
(yes = 800000, no = 1250000).

Stellar Expert:
- pool:     https://stellar.expert/explorer/testnet/contract/CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA
- verifier: https://stellar.expert/explorer/testnet/contract/CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X

---

## Verified end-to-end flow (authoritative, 2026-07-04)

A complete **shield → private_swap → unshield** flow executed on Stellar testnet
via the `syzy-shield` CLI (`cli/`). Each step generated a real off-chain Groth16
proof and landed a real proof-gated transaction. All three confirmed
`successful = true` on Horizon; each carries a BN254 Groth16 proof verified
on-chain by the verifier contract.

| Field | Value |
| --- | --- |
| Pool (depth-8) | `CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA` |
| Verifier | `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X` |
| XLM SAC (collateral) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Deposit account | `GCTFKIEFI4HTCLPTNSE2C7LZT2A47SARD4UWXF7PW7PUE33GJB4KJQYC` |
| Fresh (unlinked) withdrawal account | `GBMB355KG5ILPOLTBG7VRDDBUULBJLOJA37UFOSAGLRW4G2QFCINDNTB` |

| Step | Entrypoint | Tx hash | Stellar Expert |
| --- | --- | --- | --- |
| 1. shield | `shield` | `10a42d8f8a9e84c79c0a0c4c7c37d36839d8128c4e5dd860a9a117780082c475` | https://stellar.expert/explorer/testnet/tx/10a42d8f8a9e84c79c0a0c4c7c37d36839d8128c4e5dd860a9a117780082c475 |
| 2. private_swap | `private_swap` | `4da5f1e6d18817ba270d29b817b1854af5ca1fdc57cb97484372401d6e65fac8` | https://stellar.expert/explorer/testnet/tx/4da5f1e6d18817ba270d29b817b1854af5ca1fdc57cb97484372401d6e65fac8 |
| 3. unshield | `unshield` | `0182ba4bd235e72a0ecc8701b21a5ec9aaa82905132e86f03c9c0d3fa692e3c2` | https://stellar.expert/explorer/testnet/tx/0182ba4bd235e72a0ecc8701b21a5ec9aaa82905132e86f03c9c0d3fa692e3c2 |

### AMM constant product (integer-exact)

Reserves seeded `yes = no = 1_000_000`. Receiving YES pays into the NO leg, so
`reserveIn = no`, `reserveOut = yes`. The circuit enforces `k` EXACTLY, so
`amountIn` is chosen so `reserveInAfter` divides `k`:

```
k               = 1_000_000 * 1_000_000 = 1e12
amountIn        = 250_000  ->  reserveInAfter  = 1_250_000   (divides 1e12)
reserveOutAfter = 1e12 / 1_250_000 = 800_000
amountOut       = 1_000_000 - 800_000 = 200_000   (YES received)
change          = 1_000_000 - 250_000 = 750_000   (collateral change note)
1_000_000 * 1_000_000 == 1_250_000 * 800_000   (both 1e12)
```

`asset_out` encoding: the CLI passes selector `0`=YES / `1`=NO; the contract
forwards `asset_out + 1` as the Groth16 public input (circuit `assetOut` is the
note-scheme id, YES=1 / NO=2).

### Unlinkability

The `unshield` recipient `GBMB355KG5ILPOLTBG7VRDDBUULBJLOJA37UFOSAGLRW4G2QFCINDNTB`
is a brand-new address funded by SDF **friendbot**, not by the deposit account.
The pool paid the `750_000` collateral to it from the pool's own balance, gated
only by the note's nullifier + Merkle proof. There is **no on-chain payment or
account-creation link** between the deposit account `GCTFKIEF…` and the
withdrawal address `GBMB355K…`; the shielded pool is the only common
counterparty. Post-flow recipient balance: `10000.0750000` XLM (10000 friendbot +
0.075 unshielded change). Full write-up: `cli/E2E.md`.

### Reproduce

```
bash contracts/scripts/deploy-pool-testnet.sh   # ONE fresh depth-8 pool + wire + seed
export SYZY_POOL_ID=<pool-id>                    # or use the config.ts default
syzy-shield init
syzy-shield shield  --amount 1000000
syzy-shield sync
syzy-shield swap    --side yes --amount 250000
syzy-shield unshield --to new
```

---

## groth16_verifier (BN254 Groth16 verifier)

Eligibility-critical milestone: **ZK proof verified on-chain on Stellar** via
`env.crypto().bn254().pairing_check(...)`. BN254 pairing is available on testnet.

| Field | Value |
| --- | --- |
| Network | testnet |
| Contract ID | `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X` |
| Deployer | `GCRBJRJPSUWLYL4LNOD7UXFM5I3QKR5HE3PTKDTOFTSEFCLBQADMFV2L` (`shielded-deployer`) |
| Wasm hash | `5ea130ee34537525338c4107da45be0be9e9bc0627ab0e79fd452ccdfa662902` |
| Deploy tx | `30381775a8401d5b78db9c60780e47bf27cbabc1cff4f9369c8a26b2db43580b` |

### Verifier VKs wired (all three circuits, depth-8 ceremony)

The verifier holds all three ceremony verification keys, refreshed from the
depth-8 ceremony (`tools/vkeys/*.vk.json`, emitted by `tools/emit-all-vkeys.js`)
so the on-chain keys match the depth-8 circuits.

| Circuit | Public inputs | IC length | VK hash |
| --- | --- | --- | --- |
| shield | 2 | 3 | `143771834798e7dce3082d7bd0c5f43ffbf1b7fd807bb8d0d54cb95370bb15c6` |
| unshield | 4 | 5 | `26c6e4571be5fc818d710ad86a68aeaa8ecdd6889f11bb5d7fbc19fcf2b3cbad` |
| private_swap (`privswap`) | 9 | 10 | `1fd9ef64daee5a12a36d18eb13027d47d913d8b044c7b25e5fc8602ad9b8b024` |

Note: on the pool, the private_swap VK is registered under the symbol `privswap`.

### Entrypoint signatures (`contracts/shielded_pool/src/lib.rs`)

```
shield(from, proof_a, proof_b, proof_c, amount, commitment, screening_ref) -> BytesN<32>
private_swap(proof_a, proof_b, proof_c, nullifier_in, out_commitment, change_commitment,
             reserve_in_before, reserve_out_before, reserve_in_after, reserve_out_after,
             asset_out: u32, fee) -> BytesN<32>
unshield(proof_a, proof_b, proof_c, root, nullifier, withdraw_amount, recipient,
         recipient_field, fee)
```

---

## SUPERSEDED pools (do NOT use)

These were deployed during bring-up and are **abandoned**. They are recorded only
to remove ambiguity; the canonical pool above is the single live instance.

| Pool contract ID | Why superseded |
| --- | --- |
| `CCGEYRCEB27GJ7PBMA4S7DJ3C2NMML4ZYOZR7HQQS3R376ZZI5AMVG2S` | First depth-8 deploy; `shield` was deferred, never carried the finished CLI E2E. |
| `CCSJFHFYS67SACE3HPEMZPQDLR3IXH76322VCFDTVML4OD5VTGE3PF5Y` | Earlier E2E run before final bring-up fixes; replaced by the canonical pool. |

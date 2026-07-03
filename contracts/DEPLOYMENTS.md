# Syzy Shielded — Contract Deployments

## groth16_verifier (BN254 Groth16 verifier)

Eligibility-critical milestone: **ZK proof verified on-chain on Stellar**. A real
snarkjs BN254 (alt_bn128) Groth16 shield proof was verified inside the Soroban
host via `env.crypto().bn254().pairing_check(...)`. BN254 pairing is available on
Stellar testnet.

| Field | Value |
| --- | --- |
| Network | testnet |
| Contract ID | `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X` |
| Deployer address | `GCRBJRJPSUWLYL4LNOD7UXFM5I3QKR5HE3PTKDTOFTSEFCLBQADMFV2L` (`shielded-deployer`) |
| Wasm hash | `5ea130ee34537525338c4107da45be0be9e9bc0627ab0e79fd452ccdfa662902` |
| Deploy tx | `30381775a8401d5b78db9c60780e47bf27cbabc1cff4f9369c8a26b2db43580b` |
| `set_vk` tx | `4109fb48163cee039b90d2d2988b7782ba60578d567b6ea2f887f6f4b7036542` |
| `verify` tx | `161356db24e6481c5cf73ef7140b7014a55ae06a129e05eca0644b457240449f` |
| `verify` result | `true` |
| deployed | 2026-07-03 |

Stellar Expert (verify tx):
https://stellar.expert/explorer/testnet/tx/161356db24e6481c5cf73ef7140b7014a55ae06a129e05eca0644b457240449f

### Reproduce the invocation

Proof/vkey fixture: `groth16_verifier/src/testdata/shield.json`.
`scripts/make-invoke-args.js` converts the fixture into CLI args (vkey/proof are
raw hex; the decimal `public` inputs are converted to 32-byte big-endian hex for
`Vec<BytesN<32>>`).

```
node scripts/make-invoke-args.js
# set_vk
stellar contract invoke --id <CID> --source shielded-deployer --network testnet \
  -- set_vk --circuit shield --vk '<vk-json>'
# verify (on-chain)
stellar contract invoke --send=yes --id <CID> --source shielded-deployer --network testnet \
  -- verify --circuit shield --a <hex> --b <hex> --c <hex> --public_inputs '<json-array>'
```

### Verifier VKs wired (all three circuits)

The verifier now holds all three ceremony verification keys. `shield` was set
earlier; `unshield` and `private_swap` were set during the pool deploy. Hex vkey
structs are produced by `tools/emit-all-vkeys.js` (writes `tools/vkeys/*.vk.json`).

| Circuit | Public inputs | IC length | `set_vk` tx |
| --- | --- | --- | --- |
| shield | 2 | 3 | `4109fb48163cee039b90d2d2988b7782ba60578d567b6ea2f887f6f4b7036542` |
| unshield | 4 | 5 | `7036dfb3ce13bbfad11920a69af0f4ca12fcb0890b0bf6175481816b01707d05` |
| private_swap | 9 | 10 | `009ef7371d882cfc6c07d2347cddd4c52109f7fcdfe9ac2095bc30e91e02c813` |

The `private_swap` VK (10 IC points, ~2.3KB JSON arg) set **in a single tx** with
no CLI arg-size or transaction-size limit hit.

---

## shielded_pool (ZK shielded prediction-market pool)

Deployed to testnet and wired to the verifier above. Init + reserve seeding done;
a full `shield` tx with a proof is deferred to the CLI (Plan 3).

| Field | Value |
| --- | --- |
| Network | testnet |
| Pool contract ID | `CCGEYRCEB27GJ7PBMA4S7DJ3C2NMML4ZYOZR7HQQS3R376ZZI5AMVG2S` |
| Verifier contract ID | `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X` |
| XLM SAC (collateral) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Admin / deployer | `GCRBJRJPSUWLYL4LNOD7UXFM5I3QKR5HE3PTKDTOFTSEFCLBQADMFV2L` (`shielded-deployer`) |
| Wasm hash | `ab2ce01c5e4b09f423068554dcbd48fc3feb41387a86b62e771bd5cba6c69b8e` |
| Optimized wasm size | 22439 bytes |
| Deploy (upload) tx | `2f5ac5a653c30e52e175f4b1a593e9a9d38aaab48519bbe1c26ef7bb27729609` |
| Deploy (create) tx | `802e5aae7326262c61cf001929dd73e0cfc8099be4d126f6a2f22089a7a8508f` |
| `init` tx | `a7b39970cd488b51fe613a5622d1ab48f55e3b50631d91e3c6bf8750c7f397bb` |
| `seed_reserves` tx (yes=1e6, no=1e6) | `a24a841ac636773ccf7e37b006c646dbf843e4724fb22f737210313fb0fdafac` |
| `set_vk unshield` tx | `7036dfb3ce13bbfad11920a69af0f4ca12fcb0890b0bf6175481816b01707d05` |
| `set_vk private_swap` tx | `009ef7371d882cfc6c07d2347cddd4c52109f7fcdfe9ac2095bc30e91e02c813` |
| Post-deploy `reserves()` | `["1000000","1000000"]` |
| Post-deploy `next_index()` | `0` (empty merkle tree initialized) |
| deployed | 2026-07-04 |

Stellar Expert (pool contract):
https://stellar.expert/explorer/testnet/contract/CCGEYRCEB27GJ7PBMA4S7DJ3C2NMML4ZYOZR7HQQS3R376ZZI5AMVG2S

Stellar Expert (deploy tx):
https://stellar.expert/explorer/testnet/tx/802e5aae7326262c61cf001929dd73e0cfc8099be4d126f6a2f22089a7a8508f

Reproduce the full deploy + wire + seed with:

```
bash contracts/scripts/deploy-pool-testnet.sh
```

---

## End-to-end flow (via CLI)

A complete **shield → private_swap → unshield** flow was executed on Stellar
testnet by the `syzy-shield` CLI (`cli/`), each step generating a real Groth16
proof off-chain and landing a real proof-gated transaction on-chain.

### Pool used (depth-8 instance)

The Merkle tree depth was reduced from 20 to **8** so the proof-verify +
Poseidon-insert work fits Soroban's 400M-instruction per-transaction CPU budget
(one on-chain Poseidon2 ≈ 19.1M instructions; a depth-20 `private_swap` does 40
inserts ≈ 765M, which exceeds the cap, whereas depth-8 does 16 inserts ≈ 306M).
This E2E ran against a fresh depth-8 pool wired to the existing verifier.

| Field | Value |
| --- | --- |
| Pool contract ID (depth-8, this run) | `CCSJFHFYS67SACE3HPEMZPQDLR3IXH76322VCFDTVML4OD5VTGE3PF5Y` |
| Verifier contract ID | `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X` |
| XLM SAC (collateral) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Deposit account (funds shield) | `GAVM6MGAM6SKR46PH3QRR7WP34TWQADVDR26EFXMTBFCKTPQJREGYZBN` |
| Seeded reserves (yes, no) | `1_000_000`, `1_000_000` |

The verifier's three VKs were (re)set from the current ceremony
(`tools/vkeys/*.vk.json`) so the on-chain keys match the depth-8 circuits:
`shield` `143771834798e7dce3082d7bd0c5f43ffbf1b7fd807bb8d0d54cb95370bb15c6`,
`unshield` `26c6e4571be5fc818d710ad86a68aeaa8ecdd6889f11bb5d7fbc19fcf2b3cbad`,
`privswap` `1fd9ef64daee5a12a36d18eb13027d47d913d8b044c7b25e5fc8602ad9b8b024`.

### Transactions (all SUCCESS)

| Step | Entrypoint | Tx hash | Stellar Expert |
| --- | --- | --- | --- |
| 1. shield 1_000_000 collateral | `shield` | `806e142ee75ddd4be9cb12189f90bc550c63cd779f89ffeb8f152504084f0cb5` | https://stellar.expert/explorer/testnet/tx/806e142ee75ddd4be9cb12189f90bc550c63cd779f89ffeb8f152504084f0cb5 |
| 2. swap 250_000 collateral → 200_000 YES (+750_000 change) | `private_swap` | `f9548d536b2afb1c4f3a96009cf7bb2beae4bf3c83c3067b4fe877b982dca9fa` | https://stellar.expert/explorer/testnet/tx/f9548d536b2afb1c4f3a96009cf7bb2beae4bf3c83c3067b4fe877b982dca9fa |
| 3. unshield 750_000 change note → fresh address | `unshield` | `a2014c8bbae2551329a99bf7d72aa4a68b161ac3fc2410b07f1299e1c5ad7f2d` | https://stellar.expert/explorer/testnet/tx/a2014c8bbae2551329a99bf7d72aa4a68b161ac3fc2410b07f1299e1c5ad7f2d |

### Entrypoint signatures called (from `contracts/shielded_pool/src/lib.rs`)

```
shield(from: Address, proof_a: BytesN<64>, proof_b: BytesN<128>,
       proof_c: BytesN<64>, amount: i128, commitment: BytesN<32>,
       screening_ref: BytesN<32>) -> BytesN<32>

private_swap(proof_a: BytesN<64>, proof_b: BytesN<128>, proof_c: BytesN<64>,
             nullifier_in: BytesN<32>, out_commitment: BytesN<32>,
             change_commitment: BytesN<32>, reserve_in_before: i128,
             reserve_out_before: i128, reserve_in_after: i128,
             reserve_out_after: i128, asset_out: u32, fee: i128) -> BytesN<32>

unshield(proof_a: BytesN<64>, proof_b: BytesN<128>, proof_c: BytesN<64>,
         root: BytesN<32>, nullifier: BytesN<32>, withdraw_amount: i128,
         recipient: Address, recipient_field: BytesN<32>, fee: i128)
```

### AMM constant-product for the swap

Reserves seeded `yes = no = 1_000_000`. Receiving YES pays into the NO leg
(`reserveIn = no`, `reserveOut = yes`). The circuit enforces `k` EXACTLY
(`kBefore === kAfter`), so `amountIn` is chosen so `reserveInAfter` divides `k`:

```
k                = reserveInBefore * reserveOutBefore = 1_000_000 * 1_000_000 = 1e12
amountIn         = 250_000
reserveInAfter   = 1_000_000 + 250_000 = 1_250_000   (divides 1e12)
reserveOutAfter  = 1e12 / 1_250_000    = 800_000
amountOut        = 1_000_000 - 800_000 = 200_000  (YES received)
change           = 1_000_000 - 250_000 = 750_000  (collateral change note)
```

Note the `asset_out` encoding: the CLI passes the entrypoint selector `0` for YES
/ `1` for NO, and the contract forwards `asset_out + 1` as the Groth16 public
input because the circuit's `assetOut` signal is the note-scheme id (YES=1/NO=2).

### Unshield unlinkability

The `unshield` recipient was a **brand-new address**
`GDELIMCPFATQFPIM5LUISQAE7T2VA2DZF5WO3L7T4K2HHHNCIXGA6IHJ`, funded by SDF
friendbot (NOT by the deposit account). The pool paid the `750_000` collateral to
it from the pool's own balance, gated only by the note's nullifier + Merkle proof.
There is **no on-chain payment or account-creation link** between the deposit
account `GAVM6MGA…` and the withdrawal address `GDELIMCP…` — the shielded pool is
the only common counterparty. Post-flow recipient balance: `10000.0750000` XLM
(10000 friendbot + 0.075 XLM unshielded).

### Reproduce

```
# depth-8 circuits + contract; verifier VKs set from tools/vkeys/*.vk.json
export SYZY_POOL_ID=<pool-id>
syzy-shield init                       # create + friendbot-fund a wallet
syzy-shield shield --amount 1000000
syzy-shield sync                       # rebuild leaf mirror from on-chain events
syzy-shield swap --side yes --amount 250000
syzy-shield unshield --to new          # fresh, unlinked recipient
```

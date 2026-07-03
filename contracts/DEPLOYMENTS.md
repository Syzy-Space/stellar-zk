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

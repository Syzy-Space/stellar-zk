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
| deployed | <fill-in> |

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

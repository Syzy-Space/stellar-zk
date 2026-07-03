#!/usr/bin/env bash
#
# Reproducible deploy of the shielded_pool contract to Stellar testnet, wired to
# the already-deployed groth16_verifier, plus wiring the unshield + private_swap
# verification keys onto the verifier and seeding the AMM reserves.
#
# Prereqs:
#   - `stellar` CLI (tested with 25.2.0)
#   - `node` (for tools/emit-all-vkeys.js)
#   - identity `shielded-deployer` exists and is funded on testnet
#   - ceremony vkeys present at circuits/ceremony/keys/{shield,unshield,private_swap}.vkey.json
#
# Usage: bash contracts/scripts/deploy-pool-testnet.sh
set -euo pipefail

# ---- Parameters ------------------------------------------------------------ #
NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-shielded-deployer}"
VERIFIER_ID="${VERIFIER_ID:-CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # repo root
CONTRACTS="$ROOT/contracts"
WASM="$CONTRACTS/target/wasm32v1-none/release/shielded_pool.optimized.wasm"

DEPLOYER_ADDR="$(stellar keys address "$SOURCE")"
echo "Deployer: $DEPLOYER_ADDR"

invoke() { stellar contract invoke --id "$1" --source "$SOURCE" --network "$NETWORK" -- "${@:2}"; }

# ---- 1. Wire the unshield + private_swap VKs onto the verifier -------------- #
# (shield VK is already set on the verifier.)
echo "== Emitting hex vkeys =="
node "$ROOT/tools/emit-all-vkeys.js"

# The verifier stores VKs keyed by the circuit symbol the POOL passes at call
# time. The pool uses `symbol_short!` names: shield, unshield, privswap. Note the
# private_swap VK MUST be registered under `privswap` (not `private_swap`), or
# private_swap's on-chain verify traps with a missing-VK unwrap.
set_vk() { invoke "$VERIFIER_ID" set_vk --circuit "$1" --vk "$(cat "$ROOT/tools/vkeys/$2.vk.json")"; }
echo "== set_vk unshield =="
set_vk unshield unshield
echo "== set_vk privswap (from private_swap vkey) =="
set_vk privswap private_swap

# ---- 2. Build + optimize the pool wasm ------------------------------------- #
echo "== Build + optimize pool =="
( cd "$CONTRACTS" && stellar contract build )
stellar contract optimize --wasm "$CONTRACTS/target/wasm32v1-none/release/shielded_pool.wasm"
ls -l "$WASM"

# ---- 3. Testnet native XLM Stellar Asset Contract id ----------------------- #
XLM_SAC="$(stellar contract id asset --asset native \
  --network-passphrase 'Test SDF Network ; September 2015' \
  --rpc-url https://soroban-testnet.stellar.org)"
echo "XLM SAC: $XLM_SAC"

# ---- 4. Deploy the pool ---------------------------------------------------- #
echo "== Deploy pool =="
POOL_ID="$(stellar contract deploy --wasm "$WASM" --source "$SOURCE" --network "$NETWORK")"
echo "Pool: $POOL_ID"

# ---- 5. Init the pool ------------------------------------------------------ #
echo "== init pool =="
invoke "$POOL_ID" init \
  --admin "$DEPLOYER_ADDR" \
  --verifier "$VERIFIER_ID" \
  --collateral "$XLM_SAC"

# ---- 6. Seed reserves ------------------------------------------------------ #
echo "== seed_reserves =="
invoke "$POOL_ID" seed_reserves --yes 1000000 --no 1000000

# ---- 7. Sanity read -------------------------------------------------------- #
echo "== reserves =="
invoke "$POOL_ID" reserves

echo "DONE. Pool=$POOL_ID Verifier=$VERIFIER_ID XLM_SAC=$XLM_SAC"

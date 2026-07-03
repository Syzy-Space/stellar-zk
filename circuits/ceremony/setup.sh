#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=build
mkdir -p "$BUILD" ceremony/keys
PTAU=ceremony/pot14_final.ptau
# Phase 1 (universal) — download an existing Hermez ptau (2^14 constraints).
if [ ! -f "$PTAU" ]; then
  curl -L -o "$PTAU" https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau
fi
for C in shield unshield private_swap; do
  circom "$C.circom" --r1cs --wasm -o "$BUILD" -l node_modules
  npx snarkjs groth16 setup "$BUILD/$C.r1cs" "$PTAU" "$BUILD/${C}_0000.zkey"
  echo "contribution-1 entropy" | npx snarkjs zkey contribute "$BUILD/${C}_0000.zkey" "$BUILD/${C}_0001.zkey" -n="Contributor 1"
  echo "contribution-2 entropy" | npx snarkjs zkey contribute "$BUILD/${C}_0001.zkey" "ceremony/keys/${C}_final.zkey" -n="Contributor 2"
  npx snarkjs zkey verify "$BUILD/$C.r1cs" "$PTAU" "ceremony/keys/${C}_final.zkey"
  npx snarkjs zkey export verificationkey "ceremony/keys/${C}_final.zkey" "ceremony/keys/${C}.vkey.json"
done
echo "ceremony complete"

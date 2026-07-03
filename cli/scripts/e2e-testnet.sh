#!/usr/bin/env bash
#
# End-to-end shield -> private_swap -> unshield on Stellar testnet, driving the
# real syzy-shield CLI against the deployed shielded pool. Prints the THREE tx
# hashes (+ Stellar Expert links) and the fresh, unlinked withdrawal address.
#
# This is the hackathon demo evidence: three REAL testnet transactions, each
# carrying a Groth16 proof verified on-chain by the BN254 verifier contract.
#
# Swap math (integer constant product, enforced EXACTLY by the circuit):
#   reserves start 1000000/1000000 (k = 1e12).
#   side=yes -> in=NO leg, out=YES leg.  amountIn = 250000.
#   reserveIn_after  = 1000000 + 250000 = 1250000
#   reserveOut_after = 1e12 / 1250000   = 800000
#   amountOut = 1000000 - 800000 = 200000
#   check: 1000000*1000000 == 1250000*800000  (both 1e12)  ✓
#   -> YES note 200000, change collateral note 750000.
#   then unshield the 750000 change note to a BRAND-NEW address.
#
# Usage: bash cli/scripts/e2e-testnet.sh
set -euo pipefail

CLI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CLI_DIR"

# Fresh wallet/notes for a clean demo run.
STORE="${HOME}/.syzy-shield"
if [ -d "$STORE" ]; then
  echo "== Resetting local store $STORE =="
  rm -f "$STORE"/wallet.json "$STORE"/notes.json "$STORE"/leaves.json
fi

run() { echo; echo "\$ syzy-shield $*"; npx tsx src/index.ts "$@"; }

echo "============================================================"
echo " Syzy Shielded — testnet E2E: shield -> swap -> unshield"
echo "============================================================"

# 1) init (fresh, friendbot-funded)
run init

# 2) shield 0.1 XLM (1_000_000 stroops)
run shield --amount 1000000

# 3) sync + private swap (YES, amountIn=250000)
run sync
run swap --side yes --amount 250000

# 4) sync + unshield the 750000 change note to a fresh address
run sync
run unshield --amount 750000 --to new

echo
echo "== balance =="
run balance

echo
echo "E2E complete. The three tx hashes printed above (shield / private_swap /"
echo "unshield) are the demo evidence. Record them in cli/E2E.md."

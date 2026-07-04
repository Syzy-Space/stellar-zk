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
REPO_ROOT="$(cd "$CLI_DIR/.." && pwd)"
cd "$CLI_DIR"

# Fresh wallet/notes for a clean demo run.
STORE="${HOME}/.syzy-shield"
if [ -d "$STORE" ]; then
  echo "== Resetting local store $STORE =="
  rm -f "$STORE"/wallet.json "$STORE"/notes.json "$STORE"/leaves.json
fi

# --- Deploy a FRESH depth-8 pool ------------------------------------------- #
# Re-running the flow requires an EMPTY tree with 1e6/1e6 reserves: the CLI is
# the sole inserter and reconstructs only its OWN leaves (private_swap leaves are
# not emitted in any event), so it cannot rebuild a dirty pool's tree. A fresh
# pool also guarantees the hardcoded amountIn=250000 divides k exactly.
echo "============================================================"
echo " Deploying a FRESH shielded pool for this E2E run"
echo "============================================================"
DEPLOY_LOG="$(mktemp)"
bash "$REPO_ROOT/contracts/scripts/deploy-pool-testnet.sh" 2>&1 | tee "$DEPLOY_LOG"
# Parse the final "DONE. Pool=... Verifier=... XLM_SAC=..." line.
DONE_LINE="$(grep '^DONE\. Pool=' "$DEPLOY_LOG" | tail -1)"
FRESH_POOL_ID="$(echo "$DONE_LINE" | sed -n 's/.*Pool=\([A-Z0-9]*\).*/\1/p')"
FRESH_VERIFIER_ID="$(echo "$DONE_LINE" | sed -n 's/.*Verifier=\([A-Z0-9]*\).*/\1/p')"
FRESH_SAC_ID="$(echo "$DONE_LINE" | sed -n 's/.*XLM_SAC=\([A-Z0-9]*\).*/\1/p')"
rm -f "$DEPLOY_LOG"
if [ -z "$FRESH_POOL_ID" ]; then
  echo "ERROR: could not parse fresh pool id from deploy output" >&2
  exit 1
fi
export SYZY_POOL_ID="$FRESH_POOL_ID"
export SYZY_VERIFIER_ID="$FRESH_VERIFIER_ID"
export SYZY_COLLATERAL_ID="$FRESH_SAC_ID"

run() { echo; echo "\$ syzy-shield $*"; npx tsx src/index.ts "$@"; }

echo "============================================================"
echo " Syzy Shielded — testnet E2E: shield -> swap -> unshield"
echo "  FRESH POOL:     $SYZY_POOL_ID"
echo "  VERIFIER:       $SYZY_VERIFIER_ID"
echo "  COLLATERAL SAC: $SYZY_COLLATERAL_ID"
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

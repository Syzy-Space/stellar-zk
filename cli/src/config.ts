import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

// Repo root is the parent of the cli/ directory (this file lives in cli/src or cli/dist).
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

// --- Deployed testnet contracts (live) ---
export const POOL_CONTRACT_ID = env(
  "SYZY_POOL_ID",
  // Redeployed 2026-07-04 (depth-8): assetOut fix + cached zeros + depth-8 tree
  // so private_swap's two on-chain inserts + verify fit the Soroban CPU budget;
  // privswap VK wired under the correct symbol. This is the pool from the last
  // passing E2E (shield/swap/unshield) — usable for hand-driven steps. NOTE:
  // `npm run e2e` ignores this default and deploys a FRESH pool each run (the CLI
  // reconstructs only its OWN leaves, since private_swap leaves aren't emitted in
  // events, so it cannot re-run against a dirty pool).
  "CCI24SZY3JQ46AOKZ6LYX2SGUGXILEZD74POKWE7DCO4NV3FYBYNIMWB"
);
export const VERIFIER_CONTRACT_ID = env(
  "SYZY_VERIFIER_ID",
  "CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X"
);
export const COLLATERAL_SAC_ID = env(
  "SYZY_COLLATERAL_ID",
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
);

// --- Backend integration (relayer path) ---
// Base URL of the running Syzy backend that exposes /shielded/*.
export const BACKEND_URL = env("SYZY_BACKEND_URL", "http://localhost:7788");
// Public key of the backend's dedicated relayer account. Required for the
// --relayer path: it becomes the tx SOURCE so no user address appears on-chain.
// The backend holds the matching SECRET (SHIELDED_RELAYER_SECRET) and signs.
export const RELAYER_PUBLIC = env("SYZY_RELAYER_PUBLIC", "");

// --- Network ---
export const RPC_URL = env("SYZY_RPC_URL", "https://soroban-testnet.stellar.org");
export const NETWORK_PASSPHRASE = env(
  "SYZY_NETWORK_PASSPHRASE",
  "Test SDF Network ; September 2015"
);

// --- Circuit artifacts (relative to repo root) ---
export const SHIELD_WASM = env(
  "SYZY_SHIELD_WASM",
  path.join(REPO_ROOT, "circuits", "build", "shield_js", "shield.wasm")
);
export const SHIELD_ZKEY = env(
  "SYZY_SHIELD_ZKEY",
  path.join(REPO_ROOT, "circuits", "ceremony", "keys", "shield_final.zkey")
);
export const SHIELD_VKEY = env(
  "SYZY_SHIELD_VKEY",
  path.join(REPO_ROOT, "circuits", "ceremony", "keys", "shield.vkey.json")
);

export const UNSHIELD_WASM = env(
  "SYZY_UNSHIELD_WASM",
  path.join(REPO_ROOT, "circuits", "build", "unshield_js", "unshield.wasm")
);
export const UNSHIELD_ZKEY = env(
  "SYZY_UNSHIELD_ZKEY",
  path.join(REPO_ROOT, "circuits", "ceremony", "keys", "unshield_final.zkey")
);
export const UNSHIELD_VKEY = env(
  "SYZY_UNSHIELD_VKEY",
  path.join(REPO_ROOT, "circuits", "ceremony", "keys", "unshield.vkey.json")
);

export const PRIVSWAP_WASM = env(
  "SYZY_PRIVSWAP_WASM",
  path.join(REPO_ROOT, "circuits", "build", "private_swap_js", "private_swap.wasm")
);
export const PRIVSWAP_ZKEY = env(
  "SYZY_PRIVSWAP_ZKEY",
  path.join(REPO_ROOT, "circuits", "ceremony", "keys", "private_swap_final.zkey")
);
export const PRIVSWAP_VKEY = env(
  "SYZY_PRIVSWAP_VKEY",
  path.join(REPO_ROOT, "circuits", "ceremony", "keys", "private_swap.vkey.json")
);

// Asset codes used by the note commitment scheme.
export const ASSET = {
  COLLATERAL: 0n,
  YES: 1n,
  NO: 2n,
} as const;

// Merkle tree depth (must match the circuit + contract). Depth 8 (256 leaves)
// keeps the pool's on-chain Poseidon inserts within the Soroban CPU budget.
export const MERKLE_DEPTH = 8;

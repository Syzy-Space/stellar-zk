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
  "CCGEYRCEB27GJ7PBMA4S7DJ3C2NMML4ZYOZR7HQQS3R376ZZI5AMVG2S"
);
export const VERIFIER_CONTRACT_ID = env(
  "SYZY_VERIFIER_ID",
  "CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X"
);
export const COLLATERAL_SAC_ID = env(
  "SYZY_COLLATERAL_ID",
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
);

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

// Asset codes used by the note commitment scheme.
export const ASSET = {
  COLLATERAL: 0n,
  YES: 1n,
  NO: 2n,
} as const;

// Merkle tree depth (must match the circuit + contract).
export const MERKLE_DEPTH = 20;

#!/usr/bin/env node
/**
 * Reads groth16_verifier/src/testdata/shield.json and prints the arguments
 * needed to invoke set_vk and verify on the deployed contract.
 *
 * Encoding notes:
 *  - vkey/proof values are already hex strings (uncompressed BE, no 0x prefix);
 *    the Stellar CLI accepts hex for BytesN args directly.
 *  - `public` values are DECIMAL strings; each must be converted to a 32-byte
 *    big-endian hex string (64 hex chars) for the Vec<BytesN<32>> arg.
 */
const fs = require("fs");
const path = require("path");

const jsonPath = path.join(__dirname, "..", "groth16_verifier", "src", "testdata", "shield.json");
const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

// decimal string -> 32-byte big-endian hex (64 chars)
const toBE32 = (dec) => BigInt(dec).toString(16).padStart(64, "0");

const vk = {
  alpha: j.vkey.alpha,
  beta: j.vkey.beta,
  gamma: j.vkey.gamma,
  delta: j.vkey.delta,
  ic: j.vkey.ic,
};

const publicInputs = j.public.map(toBE32);

console.log("=== --vk (JSON) ===");
console.log(JSON.stringify(vk));
console.log("\n=== --a ===");
console.log(j.proof.a);
console.log("\n=== --b ===");
console.log(j.proof.b);
console.log("\n=== --c ===");
console.log(j.proof.c);
console.log("\n=== --public_inputs (JSON array) ===");
console.log(JSON.stringify(publicInputs));

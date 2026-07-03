#!/usr/bin/env node
/**
 * Converts all three ceremony vkeys (shield, unshield, private_swap) into the
 * hex Vkey struct shape consumed by the groth16_verifier `set_vk` entrypoint.
 *
 * Output: tools/vkeys/<circuit>.vk.json — each a `{alpha,beta,gamma,delta,ic:[...]}`
 * object ready to be passed as the `--vk` JSON arg to `stellar contract invoke`.
 *
 * Sanity check: prints ic.length per circuit.
 *   shield      public=2 => ic=3
 *   unshield    public=4 => ic=5
 *   private_swap public=9 => ic=10
 */
const fs = require("fs");
const path = require("path");
const { vkeyToHex } = require("./bn254-encode");

const ROOT = path.resolve(__dirname, "..");
const KEYS = path.join(ROOT, "circuits/ceremony/keys");
const OUT = path.join(ROOT, "tools/vkeys");

const EXPECTED_IC = { shield: 3, unshield: 5, private_swap: 10 };

fs.mkdirSync(OUT, { recursive: true });

let ok = true;
for (const circuit of ["shield", "unshield", "private_swap"]) {
  const vkeyPath = path.join(KEYS, `${circuit}.vkey.json`);
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
  const hex = vkeyToHex(vkey);
  const outPath = path.join(OUT, `${circuit}.vk.json`);
  fs.writeFileSync(outPath, JSON.stringify(hex) + "\n");
  const icLen = hex.ic.length;
  const exp = EXPECTED_IC[circuit];
  const status = icLen === exp ? "OK" : "MISMATCH";
  if (icLen !== exp) ok = false;
  console.log(`${circuit}: ic.length=${icLen} (expected ${exp}) => ${status}  -> ${outPath}`);
}

if (!ok) {
  console.error("IC length mismatch detected");
  process.exit(1);
}

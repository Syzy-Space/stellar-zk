const fs = require("fs");
const path = require("path");
const { vkeyToHex, proofToHex } = require("./bn254-encode");

const ROOT = path.resolve(__dirname, "..");
const vkeyPath = path.join(ROOT, "circuits/ceremony/keys/shield.vkey.json");
const proofPath = path.join(ROOT, "fixtures/shield.proof.json");
const publicPath = path.join(ROOT, "fixtures/shield.public.json");
const outDir = path.join(ROOT, "contracts/groth16_verifier/src/testdata");
const outPath = path.join(outDir, "shield.json");

const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));

const out = {
  vkey: vkeyToHex(vkey),
  proof: proofToHex(proof),
  public: publicSignals.map(String),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

const icLen = out.vkey.ic.length;
const expected = out.public.length + 1;
console.log(`Wrote ${outPath}`);
console.log(`ic.length = ${icLen}, public.length + 1 = ${expected} => ${icLen === expected ? "OK" : "MISMATCH"}`);
if (icLen !== expected) process.exit(1);

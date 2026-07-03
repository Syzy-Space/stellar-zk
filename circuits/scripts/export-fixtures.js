const path = require("path");
const fs = require("fs");
const snarkjs = require("snarkjs");
const { poseidonHelpers } = require("../test/helpers");

async function main() {
  const ROOT = path.join(__dirname, "..");
  const out = path.join(ROOT, "..", "fixtures");
  fs.mkdirSync(out, { recursive: true });
  const { H } = await poseidonHelpers();
  // shield fixture
  const ownerPk = 7n, rho = 42n, amount = 1000n;
  const commitment = H([0, amount, ownerPk, rho]);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { amount, commitment, ownerPk, rho },
    path.join(ROOT, "build/shield_js/shield.wasm"),
    path.join(ROOT, "ceremony/keys/shield_final.zkey"));
  fs.writeFileSync(path.join(out, "shield.proof.json"), JSON.stringify(proof, null, 2));
  fs.writeFileSync(path.join(out, "shield.public.json"), JSON.stringify(publicSignals, null, 2));
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  fs.writeFileSync(path.join(out, "shield.calldata.json"), JSON.stringify({ raw: calldata }, null, 2));
  console.log("fixtures written to", out);
}
main().then(() => process.exit(0));

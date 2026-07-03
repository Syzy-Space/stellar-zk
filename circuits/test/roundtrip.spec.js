const path = require("path");
const snarkjs = require("snarkjs");
const fs = require("fs");
const { poseidonHelpers } = require("./helpers");

const ROOT = path.join(__dirname, "..");
describe("groth16 round-trip (shield)", function () {
  this.timeout(300000);
  it("proves and verifies a shield witness with the ceremony keys", async () => {
    const { H } = await poseidonHelpers();
    const ownerPk = 7n, rho = 42n, amount = 1000n;
    const commitment = H([0, amount, ownerPk, rho]);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { amount, commitment, ownerPk, rho },
      path.join(ROOT, "build/shield_js/shield.wasm"),
      path.join(ROOT, "ceremony/keys/shield_final.zkey"),
    );
    const vkey = JSON.parse(fs.readFileSync(path.join(ROOT, "ceremony/keys/shield.vkey.json")));
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    if (!ok) throw new Error("proof failed to verify");
  });

  // snarkjs keeps a global worker/thread pool alive after fullProve, which
  // otherwise prevents mocha's process from exiting once the test passes.
  after(() => {
    if (globalThis.curve_bn128) globalThis.curve_bn128.terminate();
  });
});

const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const { buildPoseidon } = require("circomlibjs");

describe("shield", function () {
  this.timeout(100000);
  it("accepts a matching commitment, rejects a tampered amount", async () => {
    const circuit = await wasm_tester(path.join(__dirname, "..", "shield.circom"));
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const ownerPk = 7n, rho = 42n, amount = 1000n;
    const commitment = F.toObject(poseidon([0, amount, ownerPk, rho]));
    const w = await circuit.calculateWitness({ amount, commitment, ownerPk, rho }, true);
    await circuit.checkConstraints(w);

    let threw = false;
    try {
      const bad = await circuit.calculateWitness(
        { amount: amount + 1n, commitment, ownerPk, rho }, true);
      await circuit.checkConstraints(bad);
    } catch (e) { threw = true; }
    if (!threw) throw new Error("tampered amount should fail");
  });
});

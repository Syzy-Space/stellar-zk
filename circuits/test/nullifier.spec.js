const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const { buildPoseidon } = require("circomlibjs");

describe("Nullifier", function () {
  this.timeout(100000);
  it("derives ownerPk and nullifier via Poseidon", async () => {
    const circuit = await wasm_tester(path.join(__dirname, "nullifier_test.circom"));
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const ownerSk = 12345, rho = 999, leafIndex = 3;
    const ownerPk = F.toObject(poseidon([ownerSk]));
    const nullifier = F.toObject(poseidon([ownerSk, rho, leafIndex]));
    const w = await circuit.calculateWitness({ ownerSk, rho, leafIndex }, true);
    await circuit.assertOut(w, { ownerPk, nullifier });
  });
});

const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const { buildPoseidon } = require("circomlibjs");

describe("NoteCommitment", function () {
  this.timeout(100000);
  it("matches circomlib Poseidon(asset,amount,ownerPk,rho)", async () => {
    const circuit = await wasm_tester(path.join(__dirname, "note_test.circom"));
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const inputs = { asset: 0, amount: 1000, ownerPk: 7, rho: 42 };
    const expected = F.toObject(poseidon([0, 1000, 7, 42]));
    const w = await circuit.calculateWitness(inputs, true);
    await circuit.assertOut(w, { commitment: expected });
  });
});

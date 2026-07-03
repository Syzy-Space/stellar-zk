const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const { buildPoseidon } = require("circomlibjs");

describe("MerkleInclusion(3)", function () {
  this.timeout(100000);
  it("accepts a valid path and rejects a wrong root", async () => {
    const circuit = await wasm_tester(path.join(__dirname, "merkle_test.circom"));
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const H = (a, b) => F.toObject(poseidon([a, b]));
    const leaf = 55n;
    const sib = [11n, 22n, 33n];
    const idx = [0, 1, 0]; // 0: sibling right, 1: sibling left
    let cur = leaf;
    for (let i = 0; i < 3; i++) cur = idx[i] === 0 ? H(cur, sib[i]) : H(sib[i], cur);
    const root = cur;
    const w = await circuit.calculateWitness(
      { leaf, root, pathElements: sib, pathIndices: idx }, true);
    await circuit.checkConstraints(w);

    let threw = false;
    try {
      const bad = await circuit.calculateWitness(
        { leaf, root: root + 1n, pathElements: sib, pathIndices: idx }, true);
      await circuit.checkConstraints(bad);
    } catch (e) { threw = true; }
    if (!threw) throw new Error("wrong root should have failed");
  });
});

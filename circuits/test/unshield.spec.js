const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const { poseidonHelpers, singleLeafPath } = require("./helpers");

describe("unshield", function () {
  this.timeout(200000);
  it("accepts a valid note, rejects a wrong nullifier", async () => {
    const circuit = await wasm_tester(path.join(__dirname, "..", "unshield.circom"));
    const { H } = await poseidonHelpers();
    const ownerSk = 123n, rho = 77n, amount = 500n, recipient = 999n;
    const leafIndex = 0n; // derived in-circuit from all-zero pathIndices
    const ownerPk = H([ownerSk]);
    const commitment = H([0, amount, ownerPk, rho]);
    const nullifier = H([ownerSk, rho, leafIndex]);
    const { root, pathElements, pathIndices } = await singleLeafPath(commitment, 20);
    const input = {
      root, nullifier, withdrawAmount: amount, recipient,
      ownerSk, rho, pathElements, pathIndices,
    };
    const w = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(w);

    let threw = false;
    try {
      const bad = await circuit.calculateWitness({ ...input, nullifier: nullifier + 1n }, true);
      await circuit.checkConstraints(bad);
    } catch (e) { threw = true; }
    if (!threw) throw new Error("wrong nullifier should fail");

    // Fix 2 (leafIndex bound to path) negative case: the note sits at position 0
    // (all-zero pathIndices). Present the SAME note/commitment and the real
    // position-0 path, but a nullifier computed for a DIFFERENT leafIndex (1).
    // Before the fix, leafIndex was a free input and this would mint a fresh
    // nullifier for the same note (double-spend). Now the circuit derives
    // leafIndex = 0 from pathIndices, so nullifier for index 1 must mismatch.
    threw = false;
    try {
      const nullifierIdx1 = H([ownerSk, rho, 1n]);
      const bad = await circuit.calculateWitness(
        { ...input, nullifier: nullifierIdx1 }, true);
      await circuit.checkConstraints(bad);
    } catch (e) { threw = true; }
    if (!threw) throw new Error("nullifier for a different leafIndex should fail");
  });
});

const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const { poseidonHelpers, singleLeafPath } = require("./helpers");

describe("unshield", function () {
  this.timeout(200000);
  it("accepts a valid note, rejects a wrong nullifier", async () => {
    const circuit = await wasm_tester(path.join(__dirname, "..", "unshield.circom"));
    const { H } = await poseidonHelpers();
    const ownerSk = 123n, rho = 77n, amount = 500n, recipient = 999n, leafIndex = 0n;
    const ownerPk = H([ownerSk]);
    const commitment = H([0, amount, ownerPk, rho]);
    const nullifier = H([ownerSk, rho, leafIndex]);
    const { root, pathElements, pathIndices } = await singleLeafPath(commitment, 20);
    const input = {
      root, nullifier, withdrawAmount: amount, recipient,
      ownerSk, rho, leafIndex, pathElements, pathIndices,
    };
    const w = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(w);

    let threw = false;
    try {
      const bad = await circuit.calculateWitness({ ...input, nullifier: nullifier + 1n }, true);
      await circuit.checkConstraints(bad);
    } catch (e) { threw = true; }
    if (!threw) throw new Error("wrong nullifier should fail");
  });
});

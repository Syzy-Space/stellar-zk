const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const { poseidonHelpers, singleLeafPath } = require("./helpers");

describe("private_swap", function () {
  this.timeout(300000);
  it("accepts a valid constant-product swap, rejects a broken invariant", async () => {
    const circuit = await wasm_tester(path.join(__dirname, "..", "private_swap.circom"));
    const { H } = await poseidonHelpers();
    // exact product: 100*100=10000; after +100 in -> 200 * 50 = 10000
    const reserveInBefore = 100n, reserveOutBefore = 100n;
    const amountIn = 100n, amountOut = 50n;
    const reserveInAfter = 200n, reserveOutAfter = 50n;
    const ownerSk = 5n, rhoIn = 9n, inAmount = 300n, leafIndex = 0n;
    const assetOut = 1n, rhoOut = 3n, rhoChange = 4n;
    const ownerPk = H([ownerSk]);
    const inCommit = H([0, inAmount, ownerPk, rhoIn]);
    const nullifierIn = H([ownerSk, rhoIn, leafIndex]);
    const change = inAmount - amountIn;
    const outCommitment = H([assetOut, amountOut, ownerPk, rhoOut]);
    const changeCommitment = H([0, change, ownerPk, rhoChange]);
    const { root, pathElements, pathIndices } = await singleLeafPath(inCommit, 20);
    const input = {
      root, nullifierIn, outCommitment, changeCommitment,
      reserveInBefore, reserveOutBefore, reserveInAfter, reserveOutAfter, assetOut,
      ownerSk, inAmount, rhoIn, leafIndex, pathElements, pathIndices,
      amountIn, amountOut, rhoOut, rhoChange,
    };
    const w = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(w);

    let threw = false;
    try {
      const bad = await circuit.calculateWitness({ ...input, reserveOutAfter: 60n }, true);
      await circuit.checkConstraints(bad);
    } catch (e) { threw = true; }
    if (!threw) throw new Error("broken invariant should fail");
  });
});

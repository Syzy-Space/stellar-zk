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
    const ownerSk = 5n, rhoIn = 9n, inAmount = 300n;
    const leafIndex = 0n; // derived in-circuit from all-zero pathIndices
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
      ownerSk, inAmount, rhoIn, pathElements, pathIndices,
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

    // Fix 1 (range-check) negative case: amountIn > inAmount makes
    // change = inAmount - amountIn underflow into a huge wrapped field value.
    // Before the Num2Bits(64) on `change`, chLt (LessThan(252)) still guarded
    // this, but the range check is the load-bearing constraint. We drive a
    // spend where amountIn exceeds inAmount and keep the AMM field-equalities
    // internally consistent; the out-of-range `change` must make it THROW.
    // reserveInAfter = reserveInBefore + amountIn ; pick amountOut so the
    // constant product is preserved as a field equality.
    threw = false;
    try {
      const amountInBad = inAmount + 100n; // 400 > 300 -> change underflows
      const riAfter = reserveInBefore + amountInBad; // 500
      // keep k: 100*100=10000; 500 * roAfter == 10000 -> roAfter = 20
      const roAfter = 20n;
      const amountOutBad = reserveOutBefore - roAfter; // 80, in range
      const changeBad = inAmount - amountInBad; // negative -> wrapped, out of [0,2^64)
      const outCommitBad = H([assetOut, amountOutBad, ownerPk, rhoOut]);
      const changeCommitBad = H([0, changeBad, ownerPk, rhoChange]);
      const bad = await circuit.calculateWitness({
        ...input,
        amountIn: amountInBad,
        amountOut: amountOutBad,
        reserveInAfter: riAfter,
        reserveOutAfter: roAfter,
        outCommitment: outCommitBad,
        changeCommitment: changeCommitBad,
      }, true);
      await circuit.checkConstraints(bad);
    } catch (e) { threw = true; }
    if (!threw) throw new Error("out-of-range change (amountIn > inAmount) should fail");

    // Fix 1 (range-check) PRIMARY drain vector: amountOut LARGER than the whole
    // reserveOutBefore. Pre-Fix-1 there was NO ordering check on
    // amountOut/reserveOutAfter, so a prover could set amountOut huge and let
    // reserveOutAfter be the wrapped (field) value that satisfies the field
    // equality reserveOutAfter === reserveOutBefore - amountOut, draining the
    // pool while still satisfying the constant-product k equality. We satisfy
    // every field equality exactly; only the Num2Bits(64) on amountOut (and on
    // reserveOutAfter) rejects it now. This test would PASS (be accepted) before
    // Fix 1 and must THROW after.
    threw = false;
    try {
      // amountOut = reserveOutBefore + 1 = 101 (> reserve). Choose amountIn so
      // the field product is preserved. Field p (BN254). reserveOutAfter wraps.
      const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
      const amountOutBad = reserveOutBefore + 1n; // 101, exceeds the pool
      const reserveOutAfterBad = ((reserveOutBefore - amountOutBad) % p + p) % p; // p-1, wrapped huge
      // pick amountInBad so k holds as a FIELD equality:
      // (reserveInBefore + amountInBad) * reserveOutAfterBad === reserveInBefore*reserveOutBefore (mod p)
      // With reserveOutAfterBad = p-1 ≡ -1, RHS/(-1): reserveInAfter ≡ -(kBefore)/1... solve directly.
      const kBefore = reserveInBefore * reserveOutBefore % p; // 10000
      // reserveInAfterBad = kBefore * inv(reserveOutAfterBad) mod p
      const modpow = (b, e, m) => { b%=m; let r=1n; while(e>0n){ if(e&1n) r=r*b%m; b=b*b%m; e>>=1n;} return r; };
      const inv = (a) => modpow(((a%p)+p)%p, p-2n, p);
      const reserveInAfterBad = kBefore * inv(reserveOutAfterBad) % p;
      const amountInBad = ((reserveInAfterBad - reserveInBefore) % p + p) % p; // wrapped, but we only need field eqs
      const changeBad = ((inAmount - amountInBad) % p + p) % p;
      const outCommitBad = H([assetOut, amountOutBad, ownerPk, rhoOut]);
      const changeCommitBad = H([0, changeBad, ownerPk, rhoChange]);
      const bad = await circuit.calculateWitness({
        ...input,
        amountIn: amountInBad,
        amountOut: amountOutBad,
        reserveInAfter: reserveInAfterBad,
        reserveOutAfter: reserveOutAfterBad,
        outCommitment: outCommitBad,
        changeCommitment: changeCommitBad,
      }, true);
      await circuit.checkConstraints(bad);
    } catch (e) { threw = true; }
    if (!threw) throw new Error("amountOut > reserveOutBefore (pool drain) should fail");
  });
});

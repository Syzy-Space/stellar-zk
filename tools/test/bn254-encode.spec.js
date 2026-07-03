const { toBE32, g1ToHex, g2ToHex } = require("../bn254-encode");
const assert = require("assert");
describe("bn254-encode", () => {
  it("pads scalars to 32 bytes BE", () => {
    assert.strictEqual(toBE32("1"), "0".repeat(63) + "1");
    assert.strictEqual(toBE32("255").slice(-2), "ff");
  });
  it("G1 is 64 bytes, G2 is 128 bytes with c1-before-c0 swap", () => {
    assert.strictEqual(g1ToHex(["1", "2"]).length, 128);
    const g2 = g2ToHex([["10", "11"], ["20", "21"]]);
    assert.strictEqual(g2.length, 256);
    assert.strictEqual(g2.slice(0, 64), toBE32("11"));
    assert.strictEqual(g2.slice(64, 128), toBE32("10"));
  });
});

// BN254: Fp/Fr = 32-byte big-endian. G1 = be(x)||be(y) (64B).
// G2 = be(x_c1)||be(x_c0)||be(y_c1)||be(y_c0) (128B) — snarkjs stores real-first, so SWAP.
function toBE32(dec) {
  let h = BigInt(dec).toString(16);
  if (h.length > 64) throw new Error("scalar too large");
  return h.padStart(64, "0");
}
function g1ToHex(p) { // p = [x, y] or [x, y, "1"]
  return toBE32(p[0]) + toBE32(p[1]);
}
function g2ToHex(p) { // p = [[x0,x1],[y0,y1]] (snarkjs real-first) -> emit c1 first
  return toBE32(p[0][1]) + toBE32(p[0][0]) + toBE32(p[1][1]) + toBE32(p[1][0]);
}
function frToHex(dec) { return toBE32(dec); }
function vkeyToHex(vk) {
  return {
    alpha: g1ToHex(vk.vk_alpha_1),
    beta: g2ToHex(vk.vk_beta_2),
    gamma: g2ToHex(vk.vk_gamma_2),
    delta: g2ToHex(vk.vk_delta_2),
    ic: vk.IC.map(g1ToHex),
  };
}
function proofToHex(proof) {
  return { a: g1ToHex(proof.pi_a), b: g2ToHex(proof.pi_b), c: g1ToHex(proof.pi_c) };
}
module.exports = { toBE32, g1ToHex, g2ToHex, frToHex, vkeyToHex, proofToHex };

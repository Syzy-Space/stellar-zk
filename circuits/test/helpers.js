const { buildPoseidon } = require("circomlibjs");

async function poseidonHelpers() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (arr) => F.toObject(poseidon(arr));
  const H2 = (a, b) => F.toObject(poseidon([a, b]));
  return { F, H, H2 };
}

// Build a depth-`depth` tree with `leaf` at index 0, empty siblings = zero-subtree roots.
async function singleLeafPath(leaf, depth) {
  const { H2 } = await poseidonHelpers();
  const zeros = [0n];
  for (let i = 1; i <= depth; i++) zeros.push(H2(zeros[i - 1], zeros[i - 1]));
  const pathElements = [], pathIndices = [];
  let cur = leaf;
  for (let i = 0; i < depth; i++) {
    pathElements.push(zeros[i]); // sibling on the right
    pathIndices.push(0);
    cur = H2(cur, zeros[i]);
  }
  return { root: cur, pathElements, pathIndices };
}

module.exports = { poseidonHelpers, singleLeafPath };

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  loadPoseidon,
  closePoseidon,
  poseidon,
  deriveOwnerPk,
  noteCommitment,
  nullifier,
  MerkleTree,
} from "../src/crypto";
import { REPO_ROOT, MERKLE_DEPTH } from "../src/config";

// Known empty-tree / fixture roots from the contract test
// (contracts/shielded_pool/src/test.rs).
const CONTRACT_FIXTURE_ROOT =
  "18469751a114b7d6bbdf882055125ca579f398148c52626f4757abd712989506";

// Shield fixture commitment = public input #2 (fixtures/shield.public.json[1]).
const FIXTURE_COMMITMENT = BigInt(
  JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "fixtures", "shield.public.json"),
      "utf8"
    )
  )[1]
);

function toHex32(x: bigint): string {
  return x.toString(16).padStart(64, "0");
}

describe("crypto", function () {
  this.timeout(60000);

  before(async () => {
    await loadPoseidon();
  });

  after(() => {
    closePoseidon();
  });

  it("poseidon([7n]) is deterministic and non-trivial", () => {
    const a = poseidon([7n]);
    const b = poseidon([7n]);
    expect(a).to.equal(b);
    expect(a).to.not.equal(0n);
  });

  it("deriveOwnerPk(sk) == Poseidon(sk)", () => {
    expect(deriveOwnerPk(7n)).to.equal(poseidon([7n]));
  });

  it("noteCommitment(0, 1000, Poseidon(7), 42) is Poseidon(asset,amount,ownerPk,rho)", () => {
    const ownerPk = deriveOwnerPk(7n);
    const c = noteCommitment(0n, 1000n, ownerPk, 42n);
    expect(c).to.equal(poseidon([0n, 1000n, ownerPk, 42n]));
    expect(c).to.not.equal(0n);
  });

  it("nullifier(sk,rho,idx) == Poseidon(sk,rho,idx)", () => {
    expect(nullifier(7n, 42n, 0n)).to.equal(poseidon([7n, 42n, 0n]));
  });

  it("empty tree root has the expected structure", () => {
    const tree = new MerkleTree(MERKLE_DEPTH);
    // sanity: empty root == zeros[DEPTH]; recompute independently.
    let z = 0n;
    for (let i = 0; i < MERKLE_DEPTH; i++) z = poseidon([z, z]);
    expect(tree.emptyRoot()).to.equal(z);
    expect(tree.root()).to.equal(z);
  });

  it("inserting the shield fixture commitment at index 0 yields the contract root", () => {
    const tree = new MerkleTree(MERKLE_DEPTH);
    const idx = tree.insert(FIXTURE_COMMITMENT);
    expect(idx).to.equal(0);
    expect(tree.nextIndex).to.equal(1);
    expect(toHex32(tree.root())).to.equal(CONTRACT_FIXTURE_ROOT);
  });

  it("pathFor(0) reconstructs the root via the circuit hashing convention", () => {
    const tree = new MerkleTree(MERKLE_DEPTH);
    const leaf = FIXTURE_COMMITMENT;
    tree.insert(leaf);
    const { pathElements, pathIndices } = tree.pathFor(0);
    expect(pathElements.length).to.equal(MERKLE_DEPTH);
    expect(pathIndices.length).to.equal(MERKLE_DEPTH);
    // Recompute root the way the circuit does.
    let cur = leaf;
    for (let i = 0; i < MERKLE_DEPTH; i++) {
      const sib = pathElements[i];
      const [l, r] = pathIndices[i] === 0 ? [cur, sib] : [sib, cur];
      cur = poseidon([l, r]);
    }
    expect(toHex32(cur)).to.equal(CONTRACT_FIXTURE_ROOT);
    // index 0 => all left children => all pathIndices 0.
    expect(pathIndices.every((p) => p === 0)).to.equal(true);
  });

  it("pathFor works for a second leaf (index 1, right child at level 0)", () => {
    const tree = new MerkleTree(MERKLE_DEPTH);
    const l0 = FIXTURE_COMMITMENT;
    const l1 = 12345n;
    tree.insert(l0);
    tree.insert(l1);
    const { pathElements, pathIndices } = tree.pathFor(1);
    expect(pathIndices[0]).to.equal(1); // leaf 1 is a right child at level 0
    expect(pathElements[0]).to.equal(l0); // its left sibling is leaf 0
    let cur = l1;
    for (let i = 0; i < MERKLE_DEPTH; i++) {
      const sib = pathElements[i];
      const [l, r] = pathIndices[i] === 0 ? [cur, sib] : [sib, cur];
      cur = poseidon([l, r]);
    }
    expect(cur).to.equal(tree.root());
  });
});

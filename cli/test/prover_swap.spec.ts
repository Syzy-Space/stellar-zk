import { expect } from "chai";
import * as fs from "fs";
import * as snarkjs from "snarkjs";
import {
  proveUnshield,
  provePrivateSwap,
  pathIndicesToLeafIndex,
  close,
} from "../src/prover";
import { UNSHIELD_VKEY, PRIVSWAP_VKEY, ASSET } from "../src/config";
import {
  loadPoseidon,
  deriveOwnerPk,
  noteCommitment,
  MerkleTree,
} from "../src/crypto";

// Build a one-note tree and return the note + its authentication path so the
// unshield / private_swap circuits (which check Merkle membership) are satisfied.
function buildNoteTree(
  asset: bigint,
  amount: bigint,
  ownerSk: bigint,
  rho: bigint
) {
  const ownerPk = deriveOwnerPk(ownerSk);
  const commitment = noteCommitment(asset, amount, ownerPk, rho);
  const tree = new MerkleTree();
  const leafIndex = tree.insert(commitment);
  const { pathElements, pathIndices } = tree.pathFor(leafIndex);
  const rootHex = tree.root().toString(16).padStart(64, "0");
  return { ownerPk, commitment, leafIndex, pathElements, pathIndices, rootHex };
}

describe("prover: unshield + private_swap", function () {
  this.timeout(180000);

  before(async () => {
    await loadPoseidon();
  });
  after(() => {
    close();
  });

  it("proveUnshield produces a vkey-valid proof over [root,nullifier,amount,recipient]", async () => {
    const ownerSk = 123n;
    const rho = 987n;
    const amount = 1_000_000n;
    const t = buildNoteTree(ASSET.COLLATERAL, amount, ownerSk, rho);

    const proof = await proveUnshield({
      ownerSk,
      rho,
      withdrawAmount: amount,
      rootHex: t.rootHex,
      pathElements: t.pathElements,
      pathIndices: t.pathIndices,
      recipientField: 42n,
    });

    expect(proof.a).to.have.length(128);
    expect(proof.b).to.have.length(256);
    expect(proof.c).to.have.length(128);
    expect(proof.publicInputs).to.have.length(4);
    // public inputs: [root, nullifier, withdrawAmount, recipient]
    expect(proof.publicSignals[2]).to.equal(amount.toString());

    const vkey = JSON.parse(fs.readFileSync(UNSHIELD_VKEY, "utf8"));
    const ok = await snarkjs.groth16.verify(
      vkey,
      proof.publicSignals,
      proof.proof
    );
    expect(ok).to.equal(true);
  });

  it("provePrivateSwap satisfies the exact constant-product AMM and verifies", async () => {
    const ownerSk = 55n;
    const rhoIn = 7777n;
    const inAmount = 1_000_000n;
    const t = buildNoteTree(ASSET.COLLATERAL, inAmount, ownerSk, rhoIn);

    // Receiving YES: in = NO reserve, out = YES reserve. Both seeded 1e6.
    const reserveInBefore = 1_000_000n;
    const reserveOutBefore = 1_000_000n;
    const amountIn = 250_000n; // reserveInAfter = 1_250_000 divides k=1e12
    const reserveInAfter = reserveInBefore + amountIn; // 1_250_000
    const k = reserveInBefore * reserveOutBefore; // 1e12
    expect(k % reserveInAfter).to.equal(0n);
    const reserveOutAfter = k / reserveInAfter; // 800_000
    const amountOut = reserveOutBefore - reserveOutAfter; // 200_000
    // constant product preserved exactly
    expect(reserveInAfter * reserveOutAfter).to.equal(k);

    const proof = await provePrivateSwap({
      ownerSk,
      inAmount,
      rhoIn,
      pathElements: t.pathElements,
      pathIndices: t.pathIndices,
      rootHex: t.rootHex,
      amountIn,
      amountOut,
      assetOut: ASSET.YES, // circuit id: YES=1
      rhoOut: 11n,
      rhoChange: 22n,
      reserveInBefore,
      reserveOutBefore,
      reserveInAfter,
      reserveOutAfter,
    });

    expect(proof.publicInputs).to.have.length(9);
    expect(proof.changeAmount).to.equal(inAmount - amountIn);

    const vkey = JSON.parse(fs.readFileSync(PRIVSWAP_VKEY, "utf8"));
    const ok = await snarkjs.groth16.verify(
      vkey,
      proof.publicSignals,
      proof.proof
    );
    expect(ok).to.equal(true);
  });

  it("pathIndicesToLeafIndex reconstructs the index from LSB-first bits", () => {
    expect(pathIndicesToLeafIndex([0, 0, 0])).to.equal(0);
    expect(pathIndicesToLeafIndex([1, 0, 1])).to.equal(5);
    expect(pathIndicesToLeafIndex([1, 1, 1])).to.equal(7);
  });
});

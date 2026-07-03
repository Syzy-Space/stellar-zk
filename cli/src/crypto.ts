import { buildPoseidon } from "circomlibjs";
import { MERKLE_DEPTH } from "./config";

// circomlibjs poseidon instance (lazy, shared). The underlying wasm spawns no
// worker for poseidon itself, but circomlibjs pulls in the bn128 curve which
// installs `globalThis.curve_bn128` with a worker pool; closePoseidon() below
// terminates it so processes/tests can exit.
type Poseidon = ((inputs: (bigint | number)[]) => Uint8Array) & {
  F: { toObject(x: Uint8Array): bigint };
};

let _poseidon: Poseidon | null = null;

export async function loadPoseidon(): Promise<Poseidon> {
  if (!_poseidon) {
    _poseidon = (await buildPoseidon()) as unknown as Poseidon;
  }
  return _poseidon;
}

/** Terminate the bn128 worker pool so the event loop can drain. */
export function closePoseidon(): void {
  const g = globalThis as unknown as { curve_bn128?: { terminate?: () => void } };
  if (g.curve_bn128 && typeof g.curve_bn128.terminate === "function") {
    g.curve_bn128.terminate();
  }
}

/** Poseidon hash of an array of field elements -> bigint. */
export function poseidon(inputs: (bigint | number)[]): bigint {
  if (!_poseidon) {
    throw new Error("poseidon not loaded; call loadPoseidon() first");
  }
  const h = _poseidon(inputs);
  return _poseidon.F.toObject(h);
}

// --- Note scheme ---------------------------------------------------------

/** ownerPk = Poseidon(ownerSk). */
export function deriveOwnerPk(sk: bigint): bigint {
  return poseidon([sk]);
}

/** commitment = Poseidon(asset, amount, ownerPk, rho). */
export function noteCommitment(
  asset: bigint,
  amount: bigint,
  ownerPk: bigint,
  rho: bigint
): bigint {
  return poseidon([asset, amount, ownerPk, rho]);
}

/** nullifier = Poseidon(ownerSk, rho, leafIndex). */
export function nullifier(sk: bigint, rho: bigint, leafIndex: bigint): bigint {
  return poseidon([sk, rho, leafIndex]);
}

// --- Incremental Merkle tree --------------------------------------------

/**
 * Incremental sparse Merkle tree (Poseidon(2), empty leaf = 0), matching the
 * contract's `merkle::insert` and the circuit's MerkleInclusion convention:
 * pathIndices[i] = 0 means the sibling is on the RIGHT (leaf is a left child).
 */
export class MerkleTree {
  readonly depth: number;
  /** zeros[i] = root of an all-empty subtree of height i. */
  private zeros: bigint[] = [];
  /** filledSubtrees[i] = current left-sibling cache at level i (matches contract). */
  private filledSubtrees: bigint[] = [];
  /** All inserted leaves, in order (for path reconstruction). */
  private leaves: bigint[] = [];
  private currentRoot: bigint;

  constructor(depth: number = MERKLE_DEPTH) {
    this.depth = depth;
    this.zeros[0] = 0n;
    for (let i = 1; i <= depth; i++) {
      this.zeros[i] = poseidon([this.zeros[i - 1], this.zeros[i - 1]]);
    }
    for (let i = 0; i < depth; i++) {
      this.filledSubtrees[i] = this.zeros[i];
    }
    this.currentRoot = this.zeros[depth];
  }

  /** Number of leaves inserted so far (== next index). */
  get nextIndex(): number {
    return this.leaves.length;
  }

  /** Insert a leaf, return its index. Mirrors the contract insert algorithm. */
  insert(leaf: bigint): number {
    const index = this.leaves.length;
    if (index >= 2 ** this.depth) {
      throw new Error("merkle tree is full");
    }
    let cur = leaf;
    let idx = index;
    for (let i = 0; i < this.depth; i++) {
      let left: bigint;
      let right: bigint;
      if (idx % 2 === 0) {
        // We are a left child: sibling is the empty subtree root.
        left = cur;
        right = this.zeros[i];
        this.filledSubtrees[i] = cur;
      } else {
        // We are a right child: sibling is the cached left subtree.
        left = this.filledSubtrees[i];
        right = cur;
      }
      cur = poseidon([left, right]);
      idx = Math.floor(idx / 2);
    }
    this.currentRoot = cur;
    this.leaves.push(leaf);
    return index;
  }

  /** Current root. */
  root(): bigint {
    return this.currentRoot;
  }

  /** Root of a fully-empty tree of this depth. */
  emptyRoot(): bigint {
    return this.zeros[this.depth];
  }

  /**
   * Merkle authentication path for the leaf at `index`.
   * Returns { pathElements, pathIndices } where pathIndices[i] = 0 means the
   * sibling is on the right (this node is a left child) — matching the circuit.
   */
  pathFor(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`leaf index ${index} out of range`);
    }
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    // Rebuild the level-0 node array from all known leaves; empty slots = 0.
    let level: bigint[] = this.leaves.slice();
    let idx = index;
    for (let i = 0; i < this.depth; i++) {
      const isRightChild = idx % 2 === 1;
      const siblingIdx = isRightChild ? idx - 1 : idx + 1;
      const sibling =
        siblingIdx < level.length ? level[siblingIdx] : this.zeros[i];
      pathElements.push(sibling);
      // pathIndices[i] = 1 when THIS node is a right child (sibling on left).
      pathIndices.push(isRightChild ? 1 : 0);

      // Hash up to the next level.
      const next: bigint[] = [];
      for (let j = 0; j < level.length; j += 2) {
        const l = level[j];
        const r = j + 1 < level.length ? level[j + 1] : this.zeros[i];
        next.push(poseidon([l, r]));
      }
      level = next;
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices };
  }
}

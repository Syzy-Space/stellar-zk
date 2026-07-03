import * as snarkjs from "snarkjs";
import type { Groth16Proof } from "snarkjs";
import {
  SHIELD_WASM,
  SHIELD_ZKEY,
  UNSHIELD_WASM,
  UNSHIELD_ZKEY,
  PRIVSWAP_WASM,
  PRIVSWAP_ZKEY,
  ASSET,
} from "./config";
import {
  loadPoseidon,
  noteCommitment,
  nullifier as computeNullifier,
  deriveOwnerPk,
} from "./crypto";
import { proofToHex, toBE32 } from "./encode";

export interface ShieldWitnessInput {
  amount: bigint;
  ownerPk: bigint;
  rho: bigint;
}

export interface ShieldProof {
  /** G1 point, 128 hex chars (0x-free). */
  a: string;
  /** G2 point, 256 hex chars (0x-free), c1-before-c0. */
  b: string;
  /** G1 point, 128 hex chars (0x-free). */
  c: string;
  /** Public inputs as 32-byte BE hex (0x-free): [amount, commitment]. */
  publicInputs: string[];
  /** The note commitment (bigint) that was inserted. */
  commitment: bigint;
  /** The raw snarkjs proof (for local verification). */
  proof: Groth16Proof;
  /** The raw public signals (decimal strings) from snarkjs. */
  publicSignals: string[];
}

/**
 * Generate a Groth16 shield proof for depositing `amount` collateral into a new
 * note owned by `ownerPk` with randomness `rho`. Asset is fixed to COLLATERAL(0)
 * by the shield circuit.
 *
 * Returns the encoded proof (a,b,c hex) and public inputs (32-byte BE hex),
 * ready for `chain.submitShield`.
 */
export async function proveShield(
  input: ShieldWitnessInput
): Promise<ShieldProof> {
  await loadPoseidon();
  const commitment = noteCommitment(
    ASSET.COLLATERAL,
    input.amount,
    input.ownerPk,
    input.rho
  );

  // Witness signals: circuit expects amount, commitment (public) + ownerPk, rho.
  const witness = {
    amount: input.amount.toString(),
    commitment: commitment.toString(),
    ownerPk: input.ownerPk.toString(),
    rho: input.rho.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness,
    SHIELD_WASM,
    SHIELD_ZKEY
  );

  const { a, b, c } = proofToHex(proof);
  const publicInputs = publicSignals.map((s) => toBE32(s));

  return {
    a,
    b,
    c,
    publicInputs,
    commitment,
    proof,
    publicSignals,
  };
}

// --- Unshield ------------------------------------------------------------

export interface UnshieldWitnessInput {
  /** Owner spending key (private). */
  ownerSk: bigint;
  /** The note's randomness. */
  rho: bigint;
  /** The amount to withdraw (== note amount; full-spend PoC). */
  withdrawAmount: bigint;
  /** Public Merkle root the note is proven against (32-byte BE hex, 0x-free). */
  rootHex: string;
  /** Merkle authentication path for the note leaf. */
  pathElements: bigint[];
  pathIndices: number[];
  /** Public field element the proof binds `recipient` to (client-chosen). */
  recipientField: bigint;
}

export interface UnshieldProof {
  a: string;
  b: string;
  c: string;
  /** [root, nullifier, withdrawAmount, recipient] as 32-byte BE hex (0x-free). */
  publicInputs: string[];
  nullifier: bigint;
  proof: Groth16Proof;
  publicSignals: string[];
}

/**
 * Generate a Groth16 unshield proof spending a note. Public inputs (fixed by
 * the circuit): [root, nullifier, withdrawAmount, recipient].
 * leafIndex is derived inside the circuit from pathIndices.
 */
export async function proveUnshield(
  input: UnshieldWitnessInput
): Promise<UnshieldProof> {
  await loadPoseidon();
  const ownerPk = deriveOwnerPk(input.ownerSk);
  // Sanity: the note commitment for this owner/amount/rho must be the leaf the
  // path authenticates (the caller supplies a path for that leaf).
  void ownerPk;

  const leafIndex = pathIndicesToLeafIndex(input.pathIndices);
  const nf = computeNullifier(input.ownerSk, input.rho, BigInt(leafIndex));

  const rootDec = BigInt("0x" + input.rootHex).toString();

  const witness = {
    root: rootDec,
    nullifier: nf.toString(),
    withdrawAmount: input.withdrawAmount.toString(),
    recipient: input.recipientField.toString(),
    ownerSk: input.ownerSk.toString(),
    rho: input.rho.toString(),
    pathElements: input.pathElements.map((e) => e.toString()),
    pathIndices: input.pathIndices.map((i) => i.toString()),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness,
    UNSHIELD_WASM,
    UNSHIELD_ZKEY
  );

  const { a, b, c } = proofToHex(proof);
  const publicInputs = publicSignals.map((s) => toBE32(s));

  return { a, b, c, publicInputs, nullifier: nf, proof, publicSignals };
}

// --- Private swap --------------------------------------------------------

export interface PrivateSwapWitnessInput {
  ownerSk: bigint;
  /** Input (collateral) note being spent. */
  inAmount: bigint;
  rhoIn: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  /** Public Merkle root (32-byte BE hex, 0x-free). */
  rootHex: string;
  /** Collateral moved into the pool for the swap (<= inAmount). */
  amountIn: bigint;
  /** Position tokens received out. */
  amountOut: bigint;
  /** Circuit asset id of the output leg: YES=1, NO=2 (matches note scheme). */
  assetOut: bigint;
  /** Randomness for the output (position) note and the change (collateral) note. */
  rhoOut: bigint;
  rhoChange: bigint;
  /** AMM reserves as seen by the circuit (in/out framing). */
  reserveInBefore: bigint;
  reserveOutBefore: bigint;
  reserveInAfter: bigint;
  reserveOutAfter: bigint;
}

export interface PrivateSwapProof {
  a: string;
  b: string;
  c: string;
  /** [root, nullifierIn, outCommitment, changeCommitment, reserveInBefore,
   *   reserveOutBefore, reserveInAfter, reserveOutAfter, assetOut] BE-hex. */
  publicInputs: string[];
  nullifierIn: bigint;
  outCommitment: bigint;
  changeCommitment: bigint;
  changeAmount: bigint;
  proof: Groth16Proof;
  publicSignals: string[];
}

export async function provePrivateSwap(
  input: PrivateSwapWitnessInput
): Promise<PrivateSwapProof> {
  await loadPoseidon();
  const ownerPk = deriveOwnerPk(input.ownerSk);
  const leafIndex = pathIndicesToLeafIndex(input.pathIndices);
  const nf = computeNullifier(input.ownerSk, input.rhoIn, BigInt(leafIndex));

  const change = input.inAmount - input.amountIn;
  const outCommitment = noteCommitment(
    input.assetOut,
    input.amountOut,
    ownerPk,
    input.rhoOut
  );
  const changeCommitment = noteCommitment(
    ASSET.COLLATERAL,
    change,
    ownerPk,
    input.rhoChange
  );

  const rootDec = BigInt("0x" + input.rootHex).toString();

  const witness = {
    root: rootDec,
    nullifierIn: nf.toString(),
    outCommitment: outCommitment.toString(),
    changeCommitment: changeCommitment.toString(),
    reserveInBefore: input.reserveInBefore.toString(),
    reserveOutBefore: input.reserveOutBefore.toString(),
    reserveInAfter: input.reserveInAfter.toString(),
    reserveOutAfter: input.reserveOutAfter.toString(),
    assetOut: input.assetOut.toString(),
    ownerSk: input.ownerSk.toString(),
    inAmount: input.inAmount.toString(),
    rhoIn: input.rhoIn.toString(),
    pathElements: input.pathElements.map((e) => e.toString()),
    pathIndices: input.pathIndices.map((i) => i.toString()),
    amountIn: input.amountIn.toString(),
    amountOut: input.amountOut.toString(),
    rhoOut: input.rhoOut.toString(),
    rhoChange: input.rhoChange.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness,
    PRIVSWAP_WASM,
    PRIVSWAP_ZKEY
  );

  const { a, b, c } = proofToHex(proof);
  const publicInputs = publicSignals.map((s) => toBE32(s));

  return {
    a,
    b,
    c,
    publicInputs,
    nullifierIn: nf,
    outCommitment,
    changeCommitment,
    changeAmount: change,
    proof,
    publicSignals,
  };
}

/** Reconstruct leafIndex from pathIndices (LSB-first bits), matching the circuit. */
export function pathIndicesToLeafIndex(pathIndices: number[]): number {
  let acc = 0;
  for (let i = 0; i < pathIndices.length; i++) {
    if (pathIndices[i]) acc += 1 << i;
  }
  return acc;
}

/**
 * Terminate the snarkjs bn128 worker pool to avoid the known event-loop hang
 * that keeps Node alive after proving. Safe to call multiple times.
 */
export function close(): void {
  const g = globalThis as unknown as {
    curve_bn128?: { terminate?: () => Promise<void> | void };
  };
  if (g.curve_bn128 && typeof g.curve_bn128.terminate === "function") {
    g.curve_bn128.terminate();
  }
}

import * as snarkjs from "snarkjs";
import type { Groth16Proof } from "snarkjs";
import { SHIELD_WASM, SHIELD_ZKEY, ASSET } from "./config";
import { loadPoseidon, noteCommitment } from "./crypto";
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

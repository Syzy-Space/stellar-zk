// Typed wrapper around the repo's tools/bn254-encode.js (CommonJS).
// G2 uses c1-before-c0 swap; scalars are 32-byte big-endian hex (0x-free).
import * as path from "path";
import { REPO_ROOT } from "./config";
import type { Groth16Proof } from "snarkjs";

/* eslint-disable @typescript-eslint/no-var-requires */
const enc = require(path.join(REPO_ROOT, "tools", "bn254-encode.js")) as {
  toBE32(dec: string | bigint): string;
  proofToHex(proof: Groth16Proof): { a: string; b: string; c: string };
  g1ToHex(p: string[]): string;
  g2ToHex(p: string[][]): string;
  vkeyToHex(vk: unknown): unknown;
};

/** 32-byte big-endian hex (64 chars, no 0x) of a decimal/bigint scalar. */
export function toBE32(dec: string | bigint): string {
  return enc.toBE32(dec);
}

/** snarkjs Groth16 proof -> { a: G1(128hex), b: G2(256hex), c: G1(128hex) }. */
export function proofToHex(proof: Groth16Proof): {
  a: string;
  b: string;
  c: string;
} {
  return enc.proofToHex(proof);
}

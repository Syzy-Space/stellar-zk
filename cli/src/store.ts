// Local wallet + note store for the syzy-shield CLI.
//
// Everything lives under ~/.syzy-shield/:
//   wallet.json  — { ownerSk (decimal), stellarSecret (S...) }
//   notes.json   — array of Note records.
//
// !!! LOSING notes.json (or wallet.json) MEANS LOSING FUNDS. The notes carry the
// only client-side record of your shielded balances (owner key + rho + leaf
// index). There is no way to recover a spendable note from chain data without
// the owner spending key and each note's rho. Back this directory up.
//
// This PoC stores keys in PLAINTEXT for reproducibility. A production wallet
// would encrypt wallet.json with a passphrase-derived key.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Keypair } from "@stellar/stellar-sdk";

export const STORE_DIR = path.join(os.homedir(), ".syzy-shield");
const WALLET_PATH = path.join(STORE_DIR, "wallet.json");
const NOTES_PATH = path.join(STORE_DIR, "notes.json");
const LEAVES_PATH = path.join(STORE_DIR, "leaves.json");

export interface Wallet {
  /** Poseidon spending key (decimal string of a bigint < field modulus). */
  ownerSk: string;
  /** Stellar secret seed (S...) that funds + authorises deposits. */
  stellarSecret: string;
}

export interface Note {
  /** Asset id in the note scheme: 0=collateral, 1=YES, 2=NO. */
  asset: number;
  /** Amount (collateral stroop-scale units, or position token units). */
  amount: string;
  /** Owner public key = Poseidon(ownerSk), decimal. */
  ownerPk: string;
  /** Note randomness, decimal. */
  rho: string;
  /** Merkle leaf index of the note commitment. */
  leafIndex: number;
  /** Note commitment (decimal) — the Merkle leaf value. */
  commitment: string;
  /** Whether the note has been spent (nullified). */
  spent: boolean;
}

function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
}

export function walletExists(): boolean {
  return fs.existsSync(WALLET_PATH);
}

export function loadWallet(): Wallet {
  if (!walletExists()) {
    throw new Error(
      `no wallet at ${WALLET_PATH}; run \`syzy-shield init\` first`
    );
  }
  return JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")) as Wallet;
}

export function saveWallet(w: Wallet): void {
  ensureDir();
  fs.writeFileSync(WALLET_PATH, JSON.stringify(w, null, 2), { mode: 0o600 });
}

export function stellarKeypair(w: Wallet): Keypair {
  return Keypair.fromSecret(w.stellarSecret);
}

export function loadNotes(): Note[] {
  if (!fs.existsSync(NOTES_PATH)) return [];
  return JSON.parse(fs.readFileSync(NOTES_PATH, "utf8")) as Note[];
}

export function saveNotes(notes: Note[]): void {
  ensureDir();
  fs.writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 2), { mode: 0o600 });
}

export function addNote(note: Note): void {
  const notes = loadNotes();
  notes.push(note);
  saveNotes(notes);
}

/** Mark the note with the given commitment as spent. */
export function markSpent(commitment: string): void {
  const notes = loadNotes();
  for (const n of notes) {
    if (n.commitment === commitment) n.spent = true;
  }
  saveNotes(notes);
}

/** First unspent note of a given asset, or undefined. */
export function firstUnspent(asset: number): Note | undefined {
  return loadNotes().find((n) => n.asset === asset && !n.spent);
}

// --- Merkle leaf mirror --------------------------------------------------
// All leaves inserted into the on-chain tree, in index order (decimal strings).
// This single-user PoC is the only actor inserting, so we mirror leaves locally
// to reconstruct authentication paths. `sync` verifies count against the chain.

export function loadLeaves(): string[] {
  if (!fs.existsSync(LEAVES_PATH)) return [];
  return JSON.parse(fs.readFileSync(LEAVES_PATH, "utf8")) as string[];
}

export function saveLeaves(leaves: string[]): void {
  ensureDir();
  fs.writeFileSync(LEAVES_PATH, JSON.stringify(leaves, null, 2), {
    mode: 0o600,
  });
}

/** Append a leaf commitment (decimal) and return its index. */
export function appendLeaf(commitmentDec: string): number {
  const leaves = loadLeaves();
  const idx = leaves.length;
  leaves.push(commitmentDec);
  saveLeaves(leaves);
  return idx;
}

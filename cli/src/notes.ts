// Encrypted-at-rest note store + Merkle sync for the syzy-shield CLI.
//
// Notes are the ONLY client-side record of shielded balances: each carries the
// owner spending key, the note randomness (rho) and, once synced, its Merkle
// leaf index. Losing this file (or the passphrase) means losing the funds.
//
// At rest the store is AES-256-GCM encrypted with a scrypt-derived key from the
// wallet passphrase (env SYZY_PASSPHRASE, or supplied explicitly). The plaintext
// is a JSON array of NoteRecord.
//
// Sync: the pool never exposes the raw commitment list, so we rebuild the
// depth-20 incremental Merkle tree from the ordered list of inserted commitments
// (obtained from contract events, or — for the single-client PoC demo — the
// commitments we appended locally as we submitted). Each of our notes is matched
// to its leaf index by recomputing its commitment and finding its position.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { MerkleTree } from "./crypto";
import { deriveOwnerPk, noteCommitment } from "./crypto";
import { MERKLE_DEPTH } from "./config";

export interface NoteRecord {
  /** Note-scheme asset id: 0=collateral, 1=YES, 2=NO. */
  asset: number;
  /** Amount (decimal string; collateral stroops or position units). */
  amount: string;
  /** Owner spending key (decimal string of a field element). */
  ownerSk: string;
  /** Note randomness (decimal string). */
  rho: string;
  /** Merkle leaf index of the note commitment, or -1 if not yet synced. */
  leafIndex: number;
  /** Whether the note has been spent (nullified). */
  spent: boolean;
}

const MAGIC = "SYZYNOTE1";
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // scrypt with default cost params — fine for a local wallet file.
  return crypto.scryptSync(passphrase, salt, 32);
}

function encrypt(plaintext: string, passphrase: string): Buffer {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Layout: MAGIC | salt | iv | tag | ciphertext.
  return Buffer.concat([Buffer.from(MAGIC, "utf8"), salt, iv, tag, enc]);
}

function decrypt(blob: Buffer, passphrase: string): string {
  const magic = blob.subarray(0, MAGIC.length).toString("utf8");
  if (magic !== MAGIC) {
    throw new Error("notes file is not a valid syzy-shield encrypted store");
  }
  let off = MAGIC.length;
  const salt = blob.subarray(off, (off += SALT_LEN));
  const iv = blob.subarray(off, (off += IV_LEN));
  const tag = blob.subarray(off, (off += TAG_LEN));
  const ct = blob.subarray(off);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    throw new Error(
      "failed to decrypt notes file (wrong passphrase or corrupt file)"
    );
  }
}

/** Rebuild a depth-20 Merkle tree from an ordered commitment list. */
export function buildTreeFromCommitments(commitments: bigint[]): MerkleTree {
  const tree = new MerkleTree(MERKLE_DEPTH);
  for (const c of commitments) tree.insert(c);
  return tree;
}

export class NotesStore {
  private readonly filePath: string;
  private readonly passphrase: string;
  private tree: MerkleTree | null = null;

  constructor(filePath: string, passphrase: string) {
    this.filePath = filePath;
    this.passphrase = passphrase;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  /** Load and decrypt all notes (empty array if the file does not exist). */
  load(): NoteRecord[] {
    if (!fs.existsSync(this.filePath)) return [];
    const blob = fs.readFileSync(this.filePath);
    const json = decrypt(blob, this.passphrase);
    return JSON.parse(json) as NoteRecord[];
  }

  private save(notes: NoteRecord[]): void {
    this.ensureDir();
    const blob = encrypt(JSON.stringify(notes), this.passphrase);
    fs.writeFileSync(this.filePath, blob, { mode: 0o600 });
  }

  addNote(note: NoteRecord): void {
    const notes = this.load();
    notes.push(note);
    this.save(notes);
  }

  /** Recompute a note's commitment (bigint) from its secret fields. */
  static commitmentOf(note: NoteRecord): bigint {
    const ownerPk = deriveOwnerPk(BigInt(note.ownerSk));
    return noteCommitment(
      BigInt(note.asset),
      BigInt(note.amount),
      ownerPk,
      BigInt(note.rho)
    );
  }

  /** Mark the note that matches this record's secrets as spent. */
  markSpent(target: NoteRecord): void {
    const targetC = NotesStore.commitmentOf(target);
    const notes = this.load();
    for (const n of notes) {
      if (NotesStore.commitmentOf(n) === targetC) n.spent = true;
    }
    this.save(notes);
  }

  /** All unspent notes of a given asset id. */
  unspentByAsset(asset: number): NoteRecord[] {
    return this.load().filter((n) => n.asset === asset && !n.spent);
  }

  /**
   * Rebuild the Merkle tree from the ordered on-chain commitment list and assign
   * each of our notes its leaf index (matched by recomputing its commitment).
   * Returns the tree. Persists updated leaf indices.
   */
  sync(commitments: bigint[]): MerkleTree {
    const tree = buildTreeFromCommitments(commitments);
    this.tree = tree;

    // Map commitment -> first index (commitments are unique in practice).
    const indexOf = new Map<bigint, number>();
    commitments.forEach((c, i) => {
      if (!indexOf.has(c)) indexOf.set(c, i);
    });

    const notes = this.load();
    let changed = false;
    for (const n of notes) {
      const c = NotesStore.commitmentOf(n);
      const idx = indexOf.get(c);
      if (idx !== undefined && n.leafIndex !== idx) {
        n.leafIndex = idx;
        changed = true;
      }
    }
    if (changed) this.save(notes);
    return tree;
  }

  /** The synced tree (throws if sync() has not run in this session). */
  currentTree(): MerkleTree {
    if (!this.tree) {
      throw new Error("tree not synced; call sync(commitments) first");
    }
    return this.tree;
  }

  /**
   * Merkle root + authentication path for a leaf index against the synced tree.
   */
  treeAndPath(leafIndex: number): {
    root: bigint;
    path: { pathElements: bigint[]; pathIndices: number[] };
  } {
    const tree = this.currentTree();
    return { root: tree.root(), path: tree.pathFor(leafIndex) };
  }
}

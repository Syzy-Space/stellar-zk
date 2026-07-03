import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  NotesStore,
  buildTreeFromCommitments,
  type NoteRecord,
} from "../src/notes";
import {
  loadPoseidon,
  closePoseidon,
  deriveOwnerPk,
  noteCommitment,
} from "../src/crypto";

describe("notes", function () {
  this.timeout(30000);

  let dir: string;

  before(async () => {
    await loadPoseidon();
  });

  after(() => {
    closePoseidon();
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "syzy-notes-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function newStore(): NotesStore {
    return new NotesStore(path.join(dir, "notes.json"), "test-passphrase");
  }

  const sampleNote = (over: Partial<NoteRecord> = {}): NoteRecord => ({
    asset: 0,
    amount: "1000000",
    ownerSk: "12345",
    rho: "6789",
    leafIndex: -1,
    spent: false,
    ...over,
  });

  it("round-trips add / unspentByAsset / markSpent through an encrypted file", () => {
    const store = newStore();
    store.addNote(sampleNote());
    store.addNote(sampleNote({ asset: 1, amount: "200000", rho: "111" }));

    // File on disk must be ciphertext, not readable JSON with our secrets.
    const raw = fs.readFileSync(path.join(dir, "notes.json"), "utf8");
    expect(raw).to.not.contain("12345");
    expect(raw).to.not.contain("1000000");

    // A fresh store instance decrypts the same records.
    const reopened = newStore();
    expect(reopened.unspentByAsset(0)).to.have.length(1);
    expect(reopened.unspentByAsset(1)).to.have.length(1);

    const collateral = reopened.unspentByAsset(0)[0];
    expect(collateral.amount).to.equal("1000000");

    reopened.markSpent(collateral);
    expect(newStore().unspentByAsset(0)).to.have.length(0);
  });

  it("wrong passphrase fails to decrypt", () => {
    newStore().addNote(sampleNote());
    const bad = new NotesStore(path.join(dir, "notes.json"), "wrong");
    expect(() => bad.unspentByAsset(0)).to.throw();
  });

  it("buildTreeFromCommitments places our note at its true leaf index", () => {
    const ownerSk = 12345n;
    const ownerPk = deriveOwnerPk(ownerSk);
    // Three commitments; ours is at index 1.
    const other0 = noteCommitment(0n, 5n, deriveOwnerPk(99n), 1n);
    const mine = noteCommitment(0n, 1000000n, ownerPk, 6789n);
    const other2 = noteCommitment(1n, 7n, deriveOwnerPk(42n), 2n);
    const commitments = [other0, mine, other2];

    const tree = buildTreeFromCommitments(commitments);
    expect(tree.nextIndex).to.equal(3);

    const idx = commitments.findIndex((c) => c === mine);
    expect(idx).to.equal(1);

    const { pathElements, pathIndices } = tree.pathFor(idx);
    expect(pathElements).to.have.length(20);
    expect(pathIndices).to.have.length(20);
  });

  it("sync assigns leafIndex to our notes by matching recomputed commitments", () => {
    const store = newStore();
    const ownerSk = 12345n;
    const ownerPk = deriveOwnerPk(ownerSk);
    const rho = 6789n;
    const mine = noteCommitment(0n, 1000000n, ownerPk, rho);

    store.addNote(
      sampleNote({ ownerSk: ownerSk.toString(), rho: rho.toString() })
    );

    // On-chain commitment order: someone else's leaf first, then ours.
    const other = noteCommitment(0n, 5n, deriveOwnerPk(99n), 1n);
    const tree = store.sync([other, mine]);

    expect(tree.nextIndex).to.equal(2);
    const note = store.unspentByAsset(0)[0];
    expect(note.leafIndex).to.equal(1);

    const { pathElements } = store.treeAndPath(note.leafIndex).path;
    expect(pathElements).to.have.length(20);
  });
});

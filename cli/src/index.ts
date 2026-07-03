#!/usr/bin/env node
import { Command } from "commander";
import * as crypto from "crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { ASSET } from "./config";
import {
  loadPoseidon,
  closePoseidon,
  deriveOwnerPk,
  noteCommitment,
  MerkleTree,
} from "./crypto";
import { close as closeProver, proveShield, proveUnshield, provePrivateSwap } from "./prover";
import {
  readReserves,
  readRoot,
  readNextIndex,
  scanShieldLeaves,
  submitShield,
  submitUnshield,
  submitPrivateSwap,
} from "./chain";
import { toBE32 } from "./encode";
import {
  Wallet,
  Note,
  STORE_DIR,
  walletExists,
  loadWallet,
  saveWallet,
  stellarKeypair,
  loadNotes,
  saveNotes,
  addNote,
  markSpent,
  firstUnspent,
  loadLeaves,
  saveLeaves,
  appendLeaf,
} from "./store";

// BN254 scalar field modulus (for reducing random field elements).
const FR =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function randFr(): bigint {
  // 31 random bytes < 2^248 < FR, so always in-field.
  return BigInt("0x" + crypto.randomBytes(31).toString("hex")) % FR;
}

function txLink(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

/** Rebuild the local Merkle tree from the mirrored leaves. */
function buildTree(): MerkleTree {
  const tree = new MerkleTree();
  for (const leaf of loadLeaves()) tree.insert(BigInt(leaf));
  return tree;
}

/**
 * Rebuild the leaf mirror from on-chain shield events and fix each local note's
 * leafIndex by matching commitments. Run before any spend so Merkle paths
 * authenticate against the real tree (robust to concurrent inserters). Returns
 * the leaf-commitment list (contiguous prefix of shield leaves).
 */
async function syncLeavesAndNotes(): Promise<string[]> {
  const shieldLeaves = await scanShieldLeaves();
  const leaves: string[] = [];
  for (const { index, commitment } of shieldLeaves) {
    leaves[index] = BigInt("0x" + commitment).toString();
  }
  const contiguous: string[] = [];
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i] === undefined) break;
    contiguous.push(leaves[i]);
  }
  if (contiguous.length > 0) saveLeaves(contiguous);
  const notes = loadNotes();
  let changed = false;
  for (const n of notes) {
    const idx = contiguous.indexOf(n.commitment);
    if (idx >= 0 && idx !== n.leafIndex) {
      n.leafIndex = idx;
      changed = true;
    }
  }
  if (changed) saveNotes(notes);
  return contiguous;
}

const ZERO32 = "00".repeat(32);

const program = new Command();

program
  .name("syzy-shield")
  .description(
    "Shield / private-swap / unshield against the Syzy shielded pool (Stellar testnet)."
  )
  .version("0.1.0");

// --- init ----------------------------------------------------------------
program
  .command("init")
  .description("Create a local wallet (owner spending key + Stellar keypair) and friendbot-fund it.")
  .option("--secret <S...>", "import an existing Stellar secret instead of generating one")
  .option("--no-fund", "skip friendbot funding")
  .action(async (opts) => {
    if (walletExists()) {
      const w = loadWallet();
      console.log(`Wallet already exists at ${STORE_DIR}/wallet.json`);
      console.log(`Stellar address: ${stellarKeypair(w).publicKey()}`);
      return;
    }
    const kp: Keypair = opts.secret
      ? Keypair.fromSecret(opts.secret)
      : Keypair.random();
    const wallet: Wallet = {
      ownerSk: randFr().toString(),
      stellarSecret: kp.secret(),
    };
    saveWallet(wallet);
    console.log(`Wallet created at ${STORE_DIR}/wallet.json`);
    console.log(`Stellar address: ${kp.publicKey()}`);
    console.log(
      "!!! Back up ~/.syzy-shield — losing wallet.json/notes.json means losing funds."
    );

    if (opts.fund && !opts.secret) {
      process.stdout.write("Funding via friendbot... ");
      const res = await fetch(
        `https://friendbot.stellar.org/?addr=${kp.publicKey()}`
      );
      console.log(res.ok ? "done" : `failed (${res.status})`);
    }
  });

// --- balance -------------------------------------------------------------
program
  .command("balance")
  .description("Show local notes and unspent shielded balances.")
  .action(() => {
    const notes = loadNotes();
    if (notes.length === 0) {
      console.log("No notes yet. Run `shield` first.");
      return;
    }
    const label = (a: number) => (a === 0 ? "COLLATERAL" : a === 1 ? "YES" : "NO");
    const bal: Record<number, bigint> = { 0: 0n, 1: 0n, 2: 0n };
    for (const n of notes) {
      const marker = n.spent ? "spent" : "UNSPENT";
      console.log(
        `[${marker}] ${label(n.asset)} amount=${n.amount} leafIndex=${n.leafIndex}`
      );
      if (!n.spent) bal[n.asset] += BigInt(n.amount);
    }
    console.log("--- unspent totals ---");
    console.log(`COLLATERAL: ${bal[0]}`);
    console.log(`YES:        ${bal[1]}`);
    console.log(`NO:         ${bal[2]}`);
  });

// --- sync ----------------------------------------------------------------
program
  .command("sync")
  .description(
    "Rebuild the local Merkle leaf mirror from on-chain shield events, fix each " +
      "note's true leafIndex, and verify the local tree root matches the chain."
  )
  .action(async () => {
    await loadPoseidon();
    const [nextIndex, chainRootHex, reserves, shieldLeaves] = await Promise.all([
      readNextIndex(),
      readRoot(),
      readReserves(),
      scanShieldLeaves(),
    ]);

    // Rebuild the ordered leaf list from on-chain shield events. This recovers
    // the TRUE leaf indices even when other clients also inserted. (private_swap
    // leaves aren't in events — a documented PoC limitation.)
    if (shieldLeaves.length > 0) {
      const leaves: string[] = [];
      for (const { index, commitment } of shieldLeaves) {
        // commitment hex -> decimal to match the local scheme.
        leaves[index] = BigInt("0x" + commitment).toString();
      }
      // Only persist a contiguous prefix (a gap means a swap leaf we can't see).
      const contiguous: string[] = [];
      for (let i = 0; i < leaves.length; i++) {
        if (leaves[i] === undefined) break;
        contiguous.push(leaves[i]);
      }
      saveLeaves(contiguous);

      // Fix each local note's leafIndex by matching its commitment.
      const notes = loadNotes();
      let fixed = 0;
      for (const n of notes) {
        const idx = contiguous.indexOf(n.commitment);
        if (idx >= 0 && idx !== n.leafIndex) {
          n.leafIndex = idx;
          fixed++;
        }
      }
      if (fixed > 0) saveNotes(notes);
      console.log(
        `synced ${contiguous.length} shield leaf(s) from events; fixed ${fixed} note index(es)`
      );
    }

    const tree = buildTree();
    const localRootHex = tree.root().toString(16).padStart(64, "0");
    console.log(`on-chain next_index: ${nextIndex}`);
    console.log(`local leaves:        ${loadLeaves().length}`);
    console.log(`on-chain root: ${chainRootHex}`);
    console.log(`local root:    ${localRootHex}`);
    console.log(`root match:    ${localRootHex === chainRootHex}`);
    console.log(`reserves (yes,no): ${reserves[0]}, ${reserves[1]}`);
    closePoseidon();
  });

// --- shield --------------------------------------------------------------
program
  .command("shield")
  .description("Deposit collateral into a new shielded note.")
  .requiredOption("--amount <n>", "collateral amount (i128 units)")
  .action(async (opts) => {
    const amount = BigInt(opts.amount);
    const wallet = loadWallet();
    const kp = stellarKeypair(wallet);
    const ownerSk = BigInt(wallet.ownerSk);

    await loadPoseidon();
    const ownerPk = deriveOwnerPk(ownerSk);
    const rho = randFr();

    console.log(`Proving shield of ${amount} collateral...`);
    const proof = await proveShield({ amount, ownerPk, rho });

    // Public inputs: [amount(BE32), commitment(BE32)].
    const commitmentHex = proof.publicInputs[1];

    console.log("Submitting shield tx...");
    const hash = await submitShield(kp, {
      from: kp.publicKey(),
      a: proof.a,
      b: proof.b,
      c: proof.c,
      amount,
      commitment: commitmentHex,
      screeningRef: ZERO32,
    });
    console.log(`shield tx: ${hash}`);
    console.log(txLink(hash));

    // Record the note. Its TRUE leaf index (and the full leaf mirror needed to
    // build a Merkle path) is established authoritatively by `sync`, which reads
    // the on-chain shield events — robust even when other clients also inserted.
    const leafIndex = appendLeaf(proof.commitment.toString());
    const note: Note = {
      asset: Number(ASSET.COLLATERAL),
      amount: amount.toString(),
      ownerPk: ownerPk.toString(),
      rho: rho.toString(),
      leafIndex,
      commitment: proof.commitment.toString(),
      spent: false,
    };
    addNote(note);
    console.log(`Saved COLLATERAL note at leafIndex ${leafIndex}.`);
    closeProver();
  });

// --- swap ----------------------------------------------------------------
program
  .command("swap")
  .description("Privately swap a collateral note into a YES/NO position note (+ change note).")
  .requiredOption("--side <yes|no>", "position to receive")
  .requiredOption("--amount <n>", "collateral to spend into the pool (amountIn)")
  .action(async (opts) => {
    const side = String(opts.side).toLowerCase();
    if (side !== "yes" && side !== "no") throw new Error("--side must be yes|no");
    const amountIn = BigInt(opts.amount);

    const wallet = loadWallet();
    const kp = stellarKeypair(wallet);
    const ownerSk = BigInt(wallet.ownerSk);

    await loadPoseidon();
    // Establish true leaf indices + leaf mirror from on-chain events first.
    await syncLeavesAndNotes();

    const input = firstUnspent(Number(ASSET.COLLATERAL));
    if (!input) throw new Error("no unspent COLLATERAL note; run `shield` first");
    const inAmount = BigInt(input.amount);
    if (amountIn > inAmount)
      throw new Error(`amountIn ${amountIn} > note amount ${inAmount}`);

    // Reserve framing (matches the contract):
    //   receiving YES -> in = NO,  out = YES
    //   receiving NO  -> in = YES, out = NO
    const [yes, no] = await readReserves();
    const reserveInBefore = side === "yes" ? no : yes;
    const reserveOutBefore = side === "yes" ? yes : no;

    // Constant-product AMM with integer floor. k = in*out.
    // reserveInAfter = reserveInBefore + amountIn
    // amountOut = reserveOutBefore - ceil(k / reserveInAfter)  [floor keeps k' >= k? see below]
    // The circuit enforces EXACT equality k_before == k_after, so we must pick
    // amountOut such that (reserveInBefore+amountIn)*(reserveOutBefore-amountOut)
    // == reserveInBefore*reserveOutBefore EXACTLY. Choose amountIn so that
    // reserveInAfter divides k exactly, then amountOut is an integer.
    const k = reserveInBefore * reserveOutBefore;
    const reserveInAfter = reserveInBefore + amountIn;
    if (k % reserveInAfter !== 0n) {
      throw new Error(
        `no exact-integer constant-product solution for amountIn=${amountIn} ` +
          `(k=${k} not divisible by reserveInAfter=${reserveInAfter}). ` +
          `Pick amountIn so (reserveIn+amountIn) divides ${k}.`
      );
    }
    const reserveOutAfter = k / reserveInAfter;
    const amountOut = reserveOutBefore - reserveOutAfter;
    if (amountOut <= 0n) throw new Error("computed amountOut <= 0");

    // circuit assetOut: YES=1, NO=2 (note-scheme asset ids).
    const assetOutCircuit = side === "yes" ? ASSET.YES : ASSET.NO;
    // contract asset_out selector: ASSET_YES=0, ASSET_NO=1.
    const assetOutContract = side === "yes" ? 0 : 1;

    const rootHex = await readRoot();
    const tree = buildTree();
    const { pathElements, pathIndices } = tree.pathFor(input.leafIndex);

    const rhoOut = randFr();
    const rhoChange = randFr();
    const ownerPk = BigInt(input.ownerPk);
    const changeAmount = inAmount - amountIn;

    console.log(
      `Swap: in=${amountIn} collateral -> out=${amountOut} ${side.toUpperCase()}, change=${changeAmount}`
    );
    console.log(
      `AMM: (${reserveInBefore})*(${reserveOutBefore})=${k} == (${reserveInAfter})*(${reserveOutAfter})=${reserveInAfter * reserveOutAfter}`
    );
    console.log("Proving private_swap...");
    const proof = await provePrivateSwap({
      ownerSk,
      inAmount,
      rhoIn: BigInt(input.rho),
      pathElements,
      pathIndices,
      rootHex,
      amountIn,
      amountOut,
      assetOut: assetOutCircuit,
      rhoOut,
      rhoChange,
      reserveInBefore,
      reserveOutBefore,
      reserveInAfter,
      reserveOutAfter,
    });

    console.log("Submitting private_swap tx...");
    const hash = await submitPrivateSwap(kp, {
      a: proof.a,
      b: proof.b,
      c: proof.c,
      nullifierIn: toBE32(proof.nullifierIn),
      outCommitment: toBE32(proof.outCommitment),
      changeCommitment: toBE32(proof.changeCommitment),
      reserveInBefore,
      reserveOutBefore,
      reserveInAfter,
      reserveOutAfter,
      assetOut: assetOutContract,
      fee: 0n,
    });
    console.log(`private_swap tx: ${hash}`);
    console.log(txLink(hash));

    // Spend input; mirror the two new leaves (out first, then change).
    markSpent(input.commitment);
    const outIndex = appendLeaf(proof.outCommitment.toString());
    const changeIndex = appendLeaf(proof.changeCommitment.toString());
    addNote({
      asset: Number(assetOutCircuit),
      amount: amountOut.toString(),
      ownerPk: ownerPk.toString(),
      rho: rhoOut.toString(),
      leafIndex: outIndex,
      commitment: proof.outCommitment.toString(),
      spent: false,
    });
    addNote({
      asset: Number(ASSET.COLLATERAL),
      amount: changeAmount.toString(),
      ownerPk: ownerPk.toString(),
      rho: rhoChange.toString(),
      leafIndex: changeIndex,
      commitment: proof.changeCommitment.toString(),
      spent: false,
    });
    console.log(
      `Saved ${side.toUpperCase()} note (leaf ${outIndex}) and change note (leaf ${changeIndex}).`
    );
    closeProver();
  });

// --- viewing-key export --------------------------------------------------
program
  .command("viewing-key")
  .description("Export the shielded viewing/spending key material.")
  .argument("<action>", "sub-action: 'export'")
  .action((action: string) => {
    if (action !== "export") throw new Error("only `viewing-key export` is supported");
    const wallet = loadWallet();
    // In this PoC the owner spending key doubles as the viewing key: with it (and
    // each note's rho) an auditor can recompute commitments/nullifiers and trace
    // the wallet's shielded activity, without being able to move funds without a
    // fresh Stellar signature. Real designs separate viewing from spending keys.
    console.log(JSON.stringify({ ownerSk: wallet.ownerSk }, null, 2));
  });

// --- unshield ------------------------------------------------------------
program
  .command("unshield")
  .description("Spend a collateral note and pay it out to a Stellar address.")
  .requiredOption("--to <address>", "recipient Stellar address (G...) or 'new' to mint a fresh one")
  .option("--amount <n>", "note amount to withdraw (defaults to the note amount)")
  .action(async (opts) => {
    const wallet = loadWallet();
    const kp = stellarKeypair(wallet);
    const ownerSk = BigInt(wallet.ownerSk);

    // `--to new` mints a brand-new, unlinked Stellar address. The pool payout is
    // a token transfer that CREATES the account (SAC transfer to a G-address that
    // doesn't exist yet establishes it), so no pre-funding is required.
    let recipient = String(opts.to);
    let freshSecret: string | undefined;
    if (recipient === "new") {
      const fresh = Keypair.random();
      recipient = fresh.publicKey();
      freshSecret = fresh.secret();
      console.log(`Generated fresh withdrawal address: ${recipient}`);
      console.log(`Fresh secret (save if you want to control it): ${freshSecret}`);
      // The XLM SAC `transfer` requires the destination account to already
      // exist. Fund it via friendbot (from SDF — NOT from the deposit account,
      // so there is no on-chain link between deposit and withdrawal).
      process.stdout.write("Funding fresh address via friendbot... ");
      const res = await fetch(`https://friendbot.stellar.org/?addr=${recipient}`);
      console.log(res.ok ? "done" : `failed (${res.status})`);
    }

    await loadPoseidon();
    // Establish true leaf indices + leaf mirror from on-chain events first.
    await syncLeavesAndNotes();

    const input = firstUnspent(Number(ASSET.COLLATERAL));
    if (!input) throw new Error("no unspent COLLATERAL note to unshield");
    const withdrawAmount = opts.amount ? BigInt(opts.amount) : BigInt(input.amount);
    if (withdrawAmount !== BigInt(input.amount)) {
      // The circuit proves the note commits to withdrawAmount, so a partial
      // withdraw would need a matching note. PoC spends the whole note.
      throw new Error(
        `unshield PoC withdraws the full note amount (${input.amount}); --amount must match or be omitted`
      );
    }

    // Use the CURRENT on-chain root (must be a known root) and the local path.
    const rootHex = await readRoot();
    const tree = buildTree();
    const { pathElements, pathIndices } = tree.pathFor(input.leafIndex);

    // recipient_field: client-chosen field element the proof binds. The contract
    // does NOT enforce recipient_field <-> recipient (documented PoC gap); we use
    // a field element derived from the recipient key so the value is meaningful.
    const recipientField =
      BigInt("0x" + Keypair.fromPublicKey(recipient).rawPublicKey().toString("hex")) %
      FR;

    console.log(`Proving unshield of ${withdrawAmount} to ${recipient}...`);
    const proof = await proveUnshield({
      ownerSk,
      rho: BigInt(input.rho),
      withdrawAmount,
      rootHex,
      pathElements,
      pathIndices,
      recipientField,
    });

    console.log("Submitting unshield tx...");
    const hash = await submitUnshield(kp, {
      a: proof.a,
      b: proof.b,
      c: proof.c,
      root: rootHex,
      nullifier: toBE32(proof.nullifier),
      withdrawAmount,
      recipient,
      recipientField: toBE32(recipientField),
      fee: 0n,
    });
    console.log(`unshield tx: ${hash}`);
    console.log(txLink(hash));

    markSpent(input.commitment);
    console.log(`Spent COLLATERAL note (leaf ${input.leafIndex}); paid ${withdrawAmount} to ${recipient}.`);
    closeProver();
  });

program.parseAsync(process.argv).catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

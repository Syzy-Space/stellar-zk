# SCRIPTS.md — Demo video presenter script

**What this is:** the exact **words to say** and **commands to run**, side by side, for the
~2:30 Syzy Shielded demo. Screen-only, one take is fine. Pair this with
[`demo-video-script.md`](demo-video-script.md) (timing) and the README architecture diagram.

- **SAY** = read this out loud (you don't need to be on camera).
- **DO** = the terminal command or browser action.
- ✂️ = a spot you can cut in editing (e.g. proof-generation waits).

---

## ⚙️ Pre-flight — OFF camera (~2 minutes before you record)

The CLI must run against a **fresh pool** (it tracks only its own notes). Set that up first:

```bash
cd ~/Desktop/syzy-shielded/cli

# make the on-screen commands read nicely
alias syzy-shield="npx tsx src/index.ts"

# deploy a fresh pool + wire the verifier + seed reserves; note the 3 IDs it prints
bash ../contracts/scripts/deploy-pool-testnet.sh
export SYZY_POOL_ID=<pool id from output>          # C...
export SYZY_VERIFIER_ID=<verifier id from output>  # C...
export SYZY_COLLATERAL_ID=<sac id from output>     # C...

# start the demo wallet clean
rm -f ~/.syzy-shield/wallet.json ~/.syzy-shield/notes.json ~/.syzy-shield/leaves.json
clear
```

Keep **this same terminal** (alias + exports set). Open a browser on
`stellar.expert/explorer/testnet` — you'll paste each tx hash into a new tab live.

> **Lower-risk option:** run `npm run e2e` once here, then just narrate over the
> scrollback + pre-opened explorer tabs during recording (no live typing).

---

## 🔴 [0:00–0:20] The problem — *browser (syzy.space or a whale-tracker), no terminal*

**SAY:**
> "Every on-chain prediction market today publishes every trade. Whales get tracked,
> copied, even doxxed — there's an entire copy-trading economy built on watching other
> people's positions. We built Syzy, a live prediction market on Stellar mainnet — and
> this is its ZK privacy layer."

**DO:** show syzy.space or a whale-tracker screenshot. No terminal yet.

---

## 🔴 [0:20–0:45] What it is — *README architecture diagram*

**SAY:**
> "This is a shielded pool — but not a mixer. Mixers hide transfers. This hides *market
> actions*: a trader deposits collateral, takes a YES or NO position against the AMM, and
> exits — and the chain verifies every step with Groth16 proofs without learning who
> traded, or which deposit funded which exit. The pool reserves stay public on purpose,
> so the market price is still a real signal. Private traders, public price discovery."

**DO:** show the architecture diagram in the README.

---

## 🔴 [0:45–1:20] Shield — *switch to the terminal*

**DO:**
```bash
syzy-shield init
```
**SAY (while it runs):**
> "Step one: my client creates a wallet and a shielded spending key — the keys never
> leave my machine."

**DO:**
```bash
syzy-shield shield --amount 1000000
```
**SAY (while it proves + submits):**
> "Now I shield: I deposit testnet XLM, and locally my client builds a Poseidon note
> commitment and a Groth16 proof." ✂️ *(cut the proof-gen wait — "proof generation takes
> about N seconds on a laptop")*

**DO:** copy the printed `shield tx: <hash>` → paste into a Stellar Expert tab.
**SAY (on the tx page):**
> "Here's the on-chain verification — the pool contract cross-called the verifier, which
> ran Stellar's native BN254 pairing check from Protocols 25 and 26. That native
> primitive is what makes verifying a real SNARK on-chain affordable."

---

## 🔴 [1:20–1:55] Private swap — *the money shot*

**DO:**
```bash
syzy-shield sync
```
**SAY:**
> "My client syncs with the on-chain tree — root matches, reserves are one million on
> each side."

**DO:**
```bash
syzy-shield swap --side yes --amount 250000
```
**SAY (while it proves + submits, then open the tx):**
> "Step two: I take a YES position — privately. Look at what the chain sees: reserves
> moved from 1,000,000/1,000,000 to 1,250,000/800,000, a nullifier was recorded, a proof
> was verified. What it does NOT see: my address, or which note I spent. The circuit
> proved the trade respected the exact constant-product invariant and the note wasn't
> double-spent — validity without identity."

**SAY (honesty beat — say it verbatim, judges reward this):**
> "One caveat we're upfront about: because the reserves are public, this single swap's
> size leaks from the reserve delta. What's cryptographically hidden is identity and the
> deposit-to-withdrawal link. Hiding per-trade size too needs batching — a production
> circuit, not this PoC."

**DO:** copy the `private_swap tx: <hash>` → paste into a Stellar Expert tab.

---

## 🔴 [1:55–2:20] Unshield to a fresh address

**DO:**
```bash
syzy-shield unshield --amount 750000 --to new
```
**SAY (while it mints + funds a fresh address, then submits):**
> "Step three: I exit — to a brand-new address."

**DO:** paste the `unshield tx: <hash>` into one tab, and the printed fresh `G...` address
into another tab.
**SAY (on the recipient page):**
> "This address was funded by friendbot, not by my deposit account. There is no on-chain
> payment or account-creation path connecting my withdrawal to my deposit — the shielded
> pool is the only common counterparty. And because Stellar has no public mempool, nobody
> could front-run any of these steps either."

---

## 🔴 [2:20–2:35] Close — *README*

**DO (optional, nice visual):**
```bash
syzy-shield balance
```
**SAY:**
> "Everything you saw is live on Stellar testnet — three real transactions, each gated by
> a Groth16 proof verified on-chain. It's compliance-aware too: encrypted viewing keys for
> auditability, screening at the pool door. This is the shielded layer of Syzy, live at
> syzy.space — the repo, contract IDs, and every tx hash are in the README. Thanks."

**DO:** end on the README (repo link + contract IDs).

---

## 📋 Command cheat-sheet (on-camera order)

```bash
syzy-shield init
syzy-shield shield   --amount 1000000
syzy-shield sync
syzy-shield swap     --side yes --amount 250000
syzy-shield unshield --amount 750000 --to new
syzy-shield balance          # optional
```
After each, copy the printed `tx:` hash → paste into `stellar.expert/explorer/testnet`.

## 🎬 Recording tips
- OBS or QuickTime, 1080p, **mic only, no music**.
- Zoom the terminal font and the explorer pages so hashes are legible.
- ✂️ Cut proof-generation and friendbot waits; keep the total 2:00–2:30.
- Do **not** skip the honesty beat in the swap section — it's a scoring point.
- Upload unlisted to YouTube/Loom and paste the link into the README + the submission form.

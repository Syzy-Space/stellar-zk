# Syzy Shielded — Demo Video Script

**Length:** ~2:30, screen-only, one take is fine.
**Hackathon:** Stellar Hacks — "Real-World ZK".

**Setup before recording:** two windows side by side — (A) terminal / CLI in
`cli/`, (B) Stellar Expert (testnet) — plus [syzy.space](https://syzy.space) in a
third tab. Have the three real txs open in explorer tabs so you can cut to them
instantly; re-run live (`npm run e2e`) or replay the recorded run.

**Real testnet evidence to show on screen (all `successful = true`):**

| Step | Tx hash | Stellar Expert |
| --- | --- | --- |
| shield | `10a42d8f8a9e84c79c0a0c4c7c37d36839d8128c4e5dd860a9a117780082c475` | https://stellar.expert/explorer/testnet/tx/10a42d8f8a9e84c79c0a0c4c7c37d36839d8128c4e5dd860a9a117780082c475 |
| private_swap | `4da5f1e6d18817ba270d29b817b1854af5ca1fdc57cb97484372401d6e65fac8` | https://stellar.expert/explorer/testnet/tx/4da5f1e6d18817ba270d29b817b1854af5ca1fdc57cb97484372401d6e65fac8 |
| unshield | `0182ba4bd235e72a0ecc8701b21a5ec9aaa82905132e86f03c9c0d3fa692e3c2` | https://stellar.expert/explorer/testnet/tx/0182ba4bd235e72a0ecc8701b21a5ec9aaa82905132e86f03c9c0d3fa692e3c2 |

- Pool (depth-8): `CDLT5U3LIA2JPFDYC5AYMZGEAPET3TMQDN5UWA26ER5EVRBKPJDCY2MA`
- Verifier: `CA4HRBVEYSQDVVRRQAVVTKMRDJLM7WFRF7ZWV6Z6GBT4KNOSCNIYUU7X`
- Deposit account: `GCTFKIEFI4HTCLPTNSE2C7LZT2A47SARD4UWXF7PW7PUE33GJB4KJQYC`
- Fresh, unlinked withdrawal address: `GBMB355KG5ILPOLTBG7VRDDBUULBJLOJA37UFOSAGLRW4G2QFCINDNTB`

---

## [0:00–0:20] The problem — *over syzy.space or a whale-tracker screenshot*

"Every on-chain prediction market today publishes every trade. Whales get
tracked, copied, even doxxed — there's an entire copy-trading economy built on
watching other people's positions. We built Syzy, a live prediction market on
Stellar mainnet — and this is its ZK privacy layer."

## [0:20–0:45] What it is — *over the architecture diagram in the README*

"This is a shielded pool — but not a mixer. Mixers hide transfers. This hides
*market actions*: a trader deposits collateral, takes a YES or NO position
against the AMM, and exits — and the chain verifies every step with Groth16
proofs without learning who traded, or which deposit funded which exit. The pool
reserves are public on purpose, so the market price stays a real signal. Private
traders, public price discovery."

## [0:45–1:20] Shield — *terminal + explorer*

"Step one: shield. I deposit testnet XLM; my client generates a Poseidon note
commitment and a Groth16 proof **locally** — keys never leave my machine." *(run
`shield`, then open the shield tx `10a42d8f…082c475` on Stellar Expert.)* "Here's
the on-chain verification — the `shielded_pool` contract cross-calls the verifier,
which runs Stellar's native BN254 pairing check from Protocols 25 and 26. That
native primitive is what makes verifying a real SNARK on-chain affordable."

## [1:20–1:55] Private swap — *the money shot*

"Step two: I take a position — privately." *(run `swap --side yes`, open the swap
tx `4da5f1e6…6e65fac8`.)* "Look at what the chain sees: pool reserves moved
1,000,000/1,000,000 → 1,250,000/800,000, a nullifier was recorded, a proof was
verified. What it does NOT see: my address, or which note I spent. The circuit
proved the trade respected the exact constant-product invariant and the note
wasn't double-spent — validity without identity."

*(Honesty beat — say it out loud:)* "One caveat we're upfront about: because the
reserves are public, this single swap's size leaks from the reserve delta. What's
cryptographically hidden is identity and the deposit-to-withdrawal link. Hiding
per-trade size too needs batching — a production circuit, not this PoC."

## [1:55–2:20] Unshield to a fresh address

"Step three: exit — to a brand-new address." *(open the unshield tx
`0182ba4b…a692e3c2`, then open the recipient
`GBMB355K…` on explorer.)* "This address was funded by friendbot, not by my
deposit account `GCTFKIEF…`. There is no on-chain payment or account-creation path
connecting my withdrawal to my deposit — the shielded pool is the only common
counterparty. And because Stellar has no public mempool, nobody could front-run
any of these steps either."

## [2:20–2:35] Close

"Everything you saw is live on Stellar testnet — three real transactions, each
gated by a Groth16 proof verified on-chain. It's compliance-aware: encrypted
viewing keys for auditability, screening at the pool door. This is the shielded
layer of Syzy, live at syzy.space — repo, contract IDs, and every tx hash are in
the README. Thanks."

---

**Recording tips:** OBS or QuickTime, 1080p, mic only, no music. If live proof
generation is slow, cut the wait — say "proof generation takes about N seconds on
a laptop" over a cut. Keep explorer tx pages zoomed so hashes are legible. Say the
honesty beat in 1:20–1:55 verbatim — the hackathon explicitly rewards it.

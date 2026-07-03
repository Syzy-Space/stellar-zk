import {
  rpc,
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  Address,
  Keypair,
  xdr,
} from "@stellar/stellar-sdk";
import { POOL_CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE } from "./config";

export function server(): rpc.Server {
  return new rpc.Server(RPC_URL, {
    allowHttp: RPC_URL.startsWith("http://"),
  });
}

/** Strip an optional 0x prefix and return a Buffer from hex. */
function hexToBuffer(hex: string, expectedLen?: number): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const buf = Buffer.from(clean, "hex");
  if (expectedLen !== undefined && buf.length !== expectedLen) {
    throw new Error(
      `expected ${expectedLen}-byte hex, got ${buf.length} bytes (${clean.length} chars)`
    );
  }
  return buf;
}

/** A BytesN ScVal from hex, with a length check. */
export function bytesScVal(hex: string, len: number): xdr.ScVal {
  return xdr.ScVal.scvBytes(hexToBuffer(hex, len));
}

export interface ShieldArgs {
  /** Address that authorises + funds the deposit (source of collateral). */
  from: string;
  a: string; // 64-byte hex
  b: string; // 128-byte hex
  c: string; // 64-byte hex
  amount: bigint;
  commitment: string; // 32-byte hex
  screeningRef: string; // 32-byte hex
}

/**
 * Build the ordered ScVal argument list for the pool `shield` invocation.
 * Contract signature:
 *   shield(from: Address, proof_a: BytesN<64>, proof_b: BytesN<128>,
 *          proof_c: BytesN<64>, amount: i128, commitment: BytesN<32>,
 *          screening_ref: BytesN<32>) -> BytesN<32>
 */
export function buildShieldArgs(args: ShieldArgs): xdr.ScVal[] {
  return [
    new Address(args.from).toScVal(),
    bytesScVal(args.a, 64),
    bytesScVal(args.b, 128),
    bytesScVal(args.c, 64),
    nativeToScVal(args.amount, { type: "i128" }),
    bytesScVal(args.commitment, 32),
    bytesScVal(args.screeningRef, 32),
  ];
}

/** Simulate a read-only contract call and return its ScVal return value. */
async function simulateRead(
  method: string,
  ...callArgs: xdr.ScVal[]
): Promise<xdr.ScVal> {
  const srv = server();
  const contract = new Contract(POOL_CONTRACT_ID);
  // A read-only source account; simulation does not require it to be funded.
  const sourceKp = Keypair.random();
  const source = new Account(sourceKp.publicKey(), "0");
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...callArgs))
    .setTimeout(30)
    .build();

  const sim = await srv.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation of ${method} failed: ${sim.error}`);
  }
  if (!sim.result) {
    throw new Error(`simulation of ${method} returned no result`);
  }
  return sim.result.retval;
}

/** reserves() -> [i128, i128]. */
export async function readReserves(): Promise<[bigint, bigint]> {
  const retval = await simulateRead("reserves");
  const arr = scValToNative(retval) as [bigint, bigint];
  return [BigInt(arr[0]), BigInt(arr[1])];
}

/** next_index() -> u32. */
export async function readNextIndex(): Promise<number> {
  const retval = await simulateRead("next_index");
  return Number(scValToNative(retval));
}

/** root() -> BytesN<32> as 0x-free hex. */
export async function readRoot(): Promise<string> {
  const retval = await simulateRead("root");
  const buf = scValToNative(retval) as Buffer;
  return Buffer.from(buf).toString("hex");
}

export interface UnshieldArgs {
  a: string; // 64-byte hex
  b: string; // 128-byte hex
  c: string; // 64-byte hex
  root: string; // 32-byte hex
  nullifier: string; // 32-byte hex
  withdrawAmount: bigint;
  recipient: string; // G... Address
  recipientField: string; // 32-byte hex (value bound by the proof)
  fee: bigint;
}

/**
 * unshield(proof_a: BytesN<64>, proof_b: BytesN<128>, proof_c: BytesN<64>,
 *          root: BytesN<32>, nullifier: BytesN<32>, withdraw_amount: i128,
 *          recipient: Address, recipient_field: BytesN<32>, fee: i128)
 */
export function buildUnshieldArgs(args: UnshieldArgs): xdr.ScVal[] {
  return [
    bytesScVal(args.a, 64),
    bytesScVal(args.b, 128),
    bytesScVal(args.c, 64),
    bytesScVal(args.root, 32),
    bytesScVal(args.nullifier, 32),
    nativeToScVal(args.withdrawAmount, { type: "i128" }),
    new Address(args.recipient).toScVal(),
    bytesScVal(args.recipientField, 32),
    nativeToScVal(args.fee, { type: "i128" }),
  ];
}

export interface PrivateSwapArgs {
  a: string; // 64-byte hex
  b: string; // 128-byte hex
  c: string; // 64-byte hex
  nullifierIn: string; // 32-byte hex
  outCommitment: string; // 32-byte hex
  changeCommitment: string; // 32-byte hex
  reserveInBefore: bigint;
  reserveOutBefore: bigint;
  reserveInAfter: bigint;
  reserveOutAfter: bigint;
  /** Contract asset_out selector: ASSET_YES=0, ASSET_NO=1. */
  assetOut: number;
  fee: bigint;
}

/**
 * private_swap(proof_a: BytesN<64>, proof_b: BytesN<128>, proof_c: BytesN<64>,
 *   nullifier_in: BytesN<32>, out_commitment: BytesN<32>,
 *   change_commitment: BytesN<32>, reserve_in_before: i128,
 *   reserve_out_before: i128, reserve_in_after: i128, reserve_out_after: i128,
 *   asset_out: u32, fee: i128)
 */
export function buildPrivateSwapArgs(args: PrivateSwapArgs): xdr.ScVal[] {
  return [
    bytesScVal(args.a, 64),
    bytesScVal(args.b, 128),
    bytesScVal(args.c, 64),
    bytesScVal(args.nullifierIn, 32),
    bytesScVal(args.outCommitment, 32),
    bytesScVal(args.changeCommitment, 32),
    nativeToScVal(args.reserveInBefore, { type: "i128" }),
    nativeToScVal(args.reserveOutBefore, { type: "i128" }),
    nativeToScVal(args.reserveInAfter, { type: "i128" }),
    nativeToScVal(args.reserveOutAfter, { type: "i128" }),
    nativeToScVal(args.assetOut, { type: "u32" }),
    nativeToScVal(args.fee, { type: "i128" }),
  ];
}

/**
 * Build, simulate/prepare, sign and submit a pool invocation.
 * Returns the transaction hash once it reaches SUCCESS (throws otherwise).
 */
export async function submit(
  kp: Keypair,
  method: string,
  callArgs: xdr.ScVal[]
): Promise<string> {
  const srv = server();
  const contract = new Contract(POOL_CONTRACT_ID);
  const account = await srv.getAccount(kp.publicKey());

  // The Soroban resource fee for these proof-verifying entrypoints is large
  // (shield ~= 0.05 XLM; the on-chain BN254 pairing + 20 Poseidon Merkle hashes
  // cost ~400M instructions). Set a generous inclusion fee so simulation can
  // attach the full resource footprint; prepareTransaction then sets the exact
  // resource fee. Too low a fee here makes the RPC reject the resource estimate.
  const tx = new TransactionBuilder(account, {
    fee: "10000000", // 1 XLM ceiling; actual fee is set from the resource estimate
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...callArgs))
    .setTimeout(120)
    .build();

  // Simulate + assemble (adds Soroban resource footprint & auth).
  const prepared = await srv.prepareTransaction(tx);
  prepared.sign(kp);

  const sent = await srv.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(
      `sendTransaction rejected: ${JSON.stringify(sent.errorResult)}`
    );
  }

  const hash = sent.hash;
  let result = await srv.getTransaction(hash);
  const deadline = Date.now() + 90000;
  while (
    result.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await srv.getTransaction(hash);
  }

  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    const detail =
      "resultXdr" in result
        ? JSON.stringify((result as { resultXdr?: unknown }).resultXdr)
        : "";
    throw new Error(`${method} tx ${hash} status=${result.status} ${detail}`);
  }
  return hash;
}

/**
 * Build, simulate/prepare, sign and submit a `shield` invocation.
 * NOTE: `args.from` must equal `kp.publicKey()` because the contract calls
 * `from.require_auth()` and pulls collateral from `from`.
 */
export async function submitShield(
  kp: Keypair,
  args: ShieldArgs
): Promise<string> {
  return submit(kp, "shield", buildShieldArgs(args));
}

export async function submitUnshield(
  kp: Keypair,
  args: UnshieldArgs
): Promise<string> {
  return submit(kp, "unshield", buildUnshieldArgs(args));
}

export async function submitPrivateSwap(
  kp: Keypair,
  args: PrivateSwapArgs
): Promise<string> {
  return submit(kp, "private_swap", buildPrivateSwapArgs(args));
}

/**
 * Build an `unshield` invocation whose SOURCE is the relayer account, prepare it
 * (simulate + assemble the Soroban resource footprint), and return the UNSIGNED
 * transaction as base64 XDR. The backend `/shielded/relay` endpoint signs it
 * with its dedicated relayer key and submits it, so the user's Stellar address
 * never appears as the tx source.
 *
 * `unshield` is the clean relayer case: it is fully proof-gated and needs NO
 * user `require_auth`, so no user signature or auth entry is required — only the
 * relayer's signature (added server-side).
 */
export async function buildUnshieldRelayXdr(
  relayerPublicKey: string,
  args: UnshieldArgs
): Promise<string> {
  return buildRelayXdr(relayerPublicKey, "unshield", buildUnshieldArgs(args));
}

/**
 * Build a relayer-sourced, prepared-but-UNSIGNED invocation of `method` on the
 * pool contract and return it as base64 XDR. Shared by the shield/private_swap/
 * unshield relayer paths: the backend `/shielded/relay` endpoint signs it with
 * its dedicated relayer key and submits it, so no user address is the tx source.
 *
 * The relayer account is the SOURCE, so for `shield` the collateral is pulled
 * from (and `from.require_auth()` is satisfied by) the relayer itself.
 */
export async function buildRelayXdr(
  relayerPublicKey: string,
  method: string,
  callArgs: xdr.ScVal[]
): Promise<string> {
  const srv = server();
  const contract = new Contract(POOL_CONTRACT_ID);
  const account = await srv.getAccount(relayerPublicKey);

  const tx = new TransactionBuilder(account, {
    fee: "10000000", // 1 XLM ceiling; prepareTransaction sets the exact resource fee
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...callArgs))
    .setTimeout(120)
    .build();

  // Simulate + assemble the Soroban footprint/auth, but DO NOT sign — the
  // backend relayer adds the only required signature.
  const prepared = await srv.prepareTransaction(tx);
  return prepared.toXDR();
}

/** Relayer-sourced `shield` XDR (collateral pulled from the relayer `from`). */
export async function buildShieldRelayXdr(
  relayerPublicKey: string,
  args: ShieldArgs
): Promise<string> {
  return buildRelayXdr(relayerPublicKey, "shield", buildShieldArgs(args));
}

/** Relayer-sourced `private_swap` XDR (fully proof-gated, no user auth). */
export async function buildPrivateSwapRelayXdr(
  relayerPublicKey: string,
  args: PrivateSwapArgs
): Promise<string> {
  return buildRelayXdr(
    relayerPublicKey,
    "private_swap",
    buildPrivateSwapArgs(args)
  );
}

/**
 * Scan the pool's contract events to reconstruct the ORDERED list of leaf
 * commitments inserted into the Merkle tree, so a client can rebuild the tree
 * and compute authentication paths even when OTHER clients also inserted.
 *
 * `shield` emits `("shield", commitment) -> (index, new_root)` — one leaf.
 * `private_swap` emits `("privswap", nullifier) -> (asset_out, new_root)` but
 * does NOT expose the two commitments in the event, so swap-inserted leaves
 * cannot be recovered from events alone (a known PoC limitation). For a tree
 * that only received shields (the common demo path) this yields the exact leaf
 * list. Returns leaves in ascending leaf-index order.
 *
 * Testnet RPC retains only recent events; `startLedger` bounds the scan.
 */
export async function scanShieldLeaves(
  lookbackLedgers = 17000
): Promise<{ index: number; commitment: string }[]> {
  const srv = server();
  const latest = await srv.getLatestLedger();
  let startLedger = latest.sequence - lookbackLedgers;
  if (startLedger < 1) startLedger = 1;

  const out: { index: number; commitment: string }[] = [];
  let cursor: string | undefined;
  const filters = [
    { type: "contract" as const, contractIds: [POOL_CONTRACT_ID] },
  ];
  // Page through events.
  for (let page = 0; page < 20; page++) {
    const resp = await srv.getEvents(
      cursor
        ? { cursor, filters, limit: 100 }
        : { startLedger, filters, limit: 100 }
    );
    for (const e of resp.events) {
      let topic0: unknown;
      try {
        topic0 = scValToNative(e.topic[0]);
      } catch {
        continue;
      }
      if (topic0 !== "shield") continue;
      const commitment = Buffer.from(
        scValToNative(e.topic[1]) as Buffer
      ).toString("hex");
      const val = scValToNative(e.value) as [number, unknown];
      const index = Number(val[0]);
      out.push({ index, commitment });
    }
    if (!resp.events.length || !resp.cursor) break;
    cursor = resp.cursor;
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

export { POOL_CONTRACT_ID };

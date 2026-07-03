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

/**
 * Build, simulate/prepare, sign and submit a `shield` invocation.
 * Returns the transaction hash once it reaches a final status.
 * NOTE: `args.from` must equal `kp.publicKey()` because the contract calls
 * `from.require_auth()` and pulls collateral from `from`.
 */
export async function submitShield(
  kp: Keypair,
  args: ShieldArgs
): Promise<string> {
  const srv = server();
  const contract = new Contract(POOL_CONTRACT_ID);
  const account = await srv.getAccount(kp.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("shield", ...buildShieldArgs(args)))
    .setTimeout(60)
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
  // Poll until the transaction leaves NOT_FOUND / PENDING.
  let result = await srv.getTransaction(hash);
  const deadline = Date.now() + 60000;
  while (
    result.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await srv.getTransaction(hash);
  }

  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`shield tx ${hash} status=${result.status}`);
  }
  return hash;
}

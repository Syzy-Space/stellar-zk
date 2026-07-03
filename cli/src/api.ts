// Typed client for the Syzy backend shielded routes. Lets the CLI go THROUGH
// the backend relayer instead of submitting Soroban txs directly, so a user
// address never has to be the tx source for proof-gated (unshield) invokes.
import { BACKEND_URL as RAW_BACKEND_URL } from "./config";

/** Shielded circuits the backend relayer accepts (mirrors the backend RelayDto). */
export type ShieldedCircuit = "shield" | "private_swap" | "unshield";

/** Base URL of the running Syzy backend (SYZY_BACKEND_URL), trailing slash stripped. */
export const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");

/** One projected market as served by GET /shielded/markets. */
export interface Market {
  id: string;
  question: string;
  yesReserve: number;
  noReserve: number;
  price: number;
}

/** The relayable payload POSTed to /shielded/relay. Mirrors the backend RelayDto. */
export interface RelayRequest {
  circuit: ShieldedCircuit;
  proofA: string;
  proofB: string;
  proofC: string;
  publicInputs: string[];
  txXdr: string;
}

export interface RelayResponse {
  txHash: string;
}

export interface ScreeningResponse {
  denied: boolean;
  reason?: string;
}

/** One decoded pool event as served by GET /shielded/events. */
export interface ShieldedEvent {
  ledger: number;
  type: string;
  topics: string[];
  value: unknown;
  txHash?: string;
}

export interface EventsResponse {
  latestLedger: number;
  events: ShieldedEvent[];
}

export interface AuditResponse {
  handle: string;
  ciphertext: string;
}

/**
 * Build the exact /shielded/relay request body from a proof + a prepared,
 * relayer-sourced tx XDR. This is the single source of truth for the DTO shape
 * so the CLI, the tests, and the backend RelayDto stay in lockstep:
 *   { circuit, proofA, proofB, proofC, publicInputs, txXdr }
 * where proofA/C are 64-byte hex (G1), proofB is 128-byte hex (G2), publicInputs
 * are 32-byte BE hex field elements, and txXdr is a base64 Soroban tx envelope
 * whose SOURCE is the backend relayer (unsigned — the backend adds the signature).
 */
export function buildRelayPayload(params: {
  circuit: ShieldedCircuit;
  a: string;
  b: string;
  c: string;
  publicInputs: string[];
  txXdr: string;
}): RelayRequest {
  return {
    circuit: params.circuit,
    proofA: params.a,
    proofB: params.b,
    proofC: params.c,
    publicInputs: params.publicInputs,
    txXdr: params.txXdr,
  };
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // Surface the backend's error message (e.g. "Simulation failed: ...").
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = Array.isArray(j.message) ? j.message.join("; ") : j.message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(`${method} ${path} -> ${res.status}: ${detail}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** GET /shielded/markets */
export function getMarkets(): Promise<Market[]> {
  return req<Market[]>("GET", "/shielded/markets");
}

/**
 * POST /shielded/relay — the backend simulates, signs with its dedicated
 * relayer key, submits, and returns the tx hash. The user address never
 * appears as the tx source.
 */
export function relay(body: RelayRequest): Promise<RelayResponse> {
  return req<RelayResponse>("POST", "/shielded/relay", body);
}

/** GET /shielded/events?since=<ledger> — pool commitment/nullifier events. */
export function getEvents(since = 0): Promise<EventsResponse> {
  const q = since > 0 ? `?since=${encodeURIComponent(String(since))}` : "";
  return req<EventsResponse>("GET", `/shielded/events${q}`);
}

/** GET /shielded/audit/:handle — return a stored viewing-key ciphertext. */
export function getAudit(handle: string): Promise<AuditResponse> {
  return req<AuditResponse>(
    "GET",
    `/shielded/audit/${encodeURIComponent(handle)}`
  );
}

/** POST /shielded/viewing-key — store an opaque viewing-key ciphertext. */
export function postViewingKey(
  handle: string,
  ciphertext: string
): Promise<{ handle: string }> {
  return req("POST", "/shielded/viewing-key", { handle, ciphertext });
}

/** GET /shielded/screening/:ref — check the denylist. */
export function getScreening(ref: string): Promise<ScreeningResponse> {
  return req<ScreeningResponse>(
    "GET",
    `/shielded/screening/${encodeURIComponent(ref)}`
  );
}

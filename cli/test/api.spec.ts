import { expect } from "chai";
import {
  getMarkets,
  getEvents,
  getAudit,
  postViewingKey,
  getScreening,
  relay,
  buildRelayPayload,
  BACKEND_URL,
  type RelayRequest,
} from "../src/api";

// A tiny fetch double: records the last request and returns a canned response.
interface Recorded {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function stubFetch(status: number, jsonBody: unknown) {
  const calls: Recorded[] = [];
  const orig = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const text = jsonBody === undefined ? "" : JSON.stringify(jsonBody);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as any;
  };
  return {
    calls,
    restore: () => {
      (globalThis as any).fetch = orig;
    },
  };
}

describe("api: buildRelayPayload (DTO shape)", () => {
  it("maps proof a/b/c to proofA/proofB/proofC and preserves publicInputs + txXdr", () => {
    const payload = buildRelayPayload({
      circuit: "unshield",
      a: "aa".repeat(64),
      b: "bb".repeat(128),
      c: "cc".repeat(64),
      publicInputs: ["11".repeat(32), "22".repeat(32)],
      txXdr: "AAAABASE64XDR==",
    });

    // Exactly the keys the backend RelayDto declares — no more, no less.
    expect(Object.keys(payload).sort()).to.deep.equal(
      ["circuit", "proofA", "proofB", "proofC", "publicInputs", "txXdr"].sort()
    );
    expect(payload.circuit).to.equal("unshield");
    expect(payload.proofA).to.equal("aa".repeat(64));
    expect(payload.proofB).to.equal("bb".repeat(128));
    expect(payload.proofC).to.equal("cc".repeat(64));
    expect(payload.publicInputs).to.deep.equal(["11".repeat(32), "22".repeat(32)]);
    expect(payload.txXdr).to.equal("AAAABASE64XDR==");

    // Never leaks a spending key or user address field.
    const asRecord = payload as unknown as Record<string, unknown>;
    expect(asRecord).to.not.have.property("ownerSk");
    expect(asRecord).to.not.have.property("secret");
    expect(asRecord).to.not.have.property("from");
  });

  it("accepts each shielded circuit id", () => {
    for (const circuit of ["shield", "private_swap", "unshield"] as const) {
      const p = buildRelayPayload({
        circuit,
        a: "00".repeat(64),
        b: "00".repeat(128),
        c: "00".repeat(64),
        publicInputs: [],
        txXdr: "x",
      });
      expect(p.circuit).to.equal(circuit);
    }
  });
});

describe("api: client request shapes (mocked fetch)", () => {
  it("getMarkets GETs /shielded/markets and returns the array", async () => {
    const f = stubFetch(200, [
      { id: "M1", question: "q?", yesReserve: 5000, noReserve: 5000, price: 0.5 },
    ]);
    try {
      const markets = await getMarkets();
      expect(f.calls[0].method).to.equal("GET");
      expect(f.calls[0].url).to.equal(`${BACKEND_URL}/shielded/markets`);
      expect(markets).to.have.length(1);
      expect(markets[0].id).to.equal("M1");
    } finally {
      f.restore();
    }
  });

  it("relay POSTs the RelayRequest body as JSON to /shielded/relay", async () => {
    const f = stubFetch(200, { txHash: "DEADBEEF" });
    const body: RelayRequest = {
      circuit: "shield",
      proofA: "aa".repeat(64),
      proofB: "bb".repeat(128),
      proofC: "cc".repeat(64),
      publicInputs: ["11".repeat(32)],
      txXdr: "AAAA==",
    };
    try {
      const res = await relay(body);
      expect(f.calls[0].method).to.equal("POST");
      expect(f.calls[0].url).to.equal(`${BACKEND_URL}/shielded/relay`);
      expect(f.calls[0].headers).to.deep.equal({ "content-type": "application/json" });
      expect(f.calls[0].body).to.deep.equal(body);
      expect(res.txHash).to.equal("DEADBEEF");
    } finally {
      f.restore();
    }
  });

  it("getEvents encodes the since cursor as a query param", async () => {
    const f = stubFetch(200, { latestLedger: 42, events: [] });
    try {
      await getEvents(0);
      expect(f.calls[0].url).to.equal(`${BACKEND_URL}/shielded/events`);
      await getEvents(123);
      expect(f.calls[1].url).to.equal(`${BACKEND_URL}/shielded/events?since=123`);
    } finally {
      f.restore();
    }
  });

  it("getAudit / getScreening url-encode the path segment", async () => {
    const f = stubFetch(200, { handle: "h/1", ciphertext: "c" });
    try {
      await getAudit("h/1");
      expect(f.calls[0].url).to.equal(`${BACKEND_URL}/shielded/audit/h%2F1`);
    } finally {
      f.restore();
    }
    const g = stubFetch(200, { denied: false });
    try {
      await getScreening("r ef");
      expect(g.calls[0].url).to.equal(`${BACKEND_URL}/shielded/screening/r%20ef`);
    } finally {
      g.restore();
    }
  });

  it("postViewingKey POSTs { handle, ciphertext }", async () => {
    const f = stubFetch(200, { handle: "h1" });
    try {
      await postViewingKey("h1", "cipher");
      expect(f.calls[0].method).to.equal("POST");
      expect(f.calls[0].url).to.equal(`${BACKEND_URL}/shielded/viewing-key`);
      expect(f.calls[0].body).to.deep.equal({ handle: "h1", ciphertext: "cipher" });
    } finally {
      f.restore();
    }
  });

  it("surfaces the backend error message on non-2xx", async () => {
    const f = stubFetch(400, { message: "Simulation failed: bad proof" });
    try {
      await relay({
        circuit: "shield",
        proofA: "a",
        proofB: "b",
        proofC: "c",
        publicInputs: [],
        txXdr: "x",
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).to.contain("Simulation failed: bad proof");
    } finally {
      f.restore();
    }
  });
});

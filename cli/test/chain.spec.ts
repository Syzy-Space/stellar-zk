import { expect } from "chai";
import { xdr, Keypair, scValToNative } from "@stellar/stellar-sdk";
import { buildShieldArgs, readReserves } from "../src/chain";

// Deterministic dummy hex of the right lengths.
const hex = (byteLen: number, fill = "ab") => fill.repeat(byteLen);

const SAMPLE = {
  from: Keypair.random().publicKey(),
  a: hex(64),
  b: hex(128),
  c: hex(64),
  amount: 1000n,
  commitment: hex(32),
  screeningRef: "00".repeat(32),
};

describe("chain: buildShieldArgs (ScVal construction)", () => {
  it("produces 7 args with the correct XDR types and lengths", () => {
    const args = buildShieldArgs(SAMPLE);
    expect(args).to.have.length(7);

    // 0: from -> Address ScVal
    expect(args[0].switch()).to.equal(xdr.ScValType.scvAddress());

    // 1..3, 5, 6: BytesN
    const bytesIdx = [1, 2, 3, 5, 6];
    for (const i of bytesIdx) {
      expect(args[i].switch(), `arg ${i} is bytes`).to.equal(
        xdr.ScValType.scvBytes()
      );
    }
    expect(args[1].bytes()).to.have.length(64);
    expect(args[2].bytes()).to.have.length(128);
    expect(args[3].bytes()).to.have.length(64);
    expect(args[5].bytes()).to.have.length(32);
    expect(args[6].bytes()).to.have.length(32);

    // 4: amount -> i128
    expect(args[4].switch()).to.equal(xdr.ScValType.scvI128());
    expect(scValToNative(args[4])).to.equal(1000n);
  });

  it("rejects a proof component with the wrong byte length", () => {
    expect(() =>
      buildShieldArgs({ ...SAMPLE, a: hex(32) })
    ).to.throw(/expected 64-byte/);
  });
});

// Network integration test — skipped when SYZY_OFFLINE is set.
const offline = process.env.SYZY_OFFLINE === "1";
(offline ? describe.skip : describe)(
  "chain: readReserves (testnet integration)",
  function () {
    this.timeout(60000);
    it("reads [1000000n, 1000000n] from the deployed pool", async () => {
      const reserves = await readReserves();
      expect(reserves).to.deep.equal([1000000n, 1000000n]);
    });
  }
);

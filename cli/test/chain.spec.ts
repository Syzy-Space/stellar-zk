import { expect } from "chai";
import { xdr, Keypair, scValToNative } from "@stellar/stellar-sdk";
import {
  buildShieldArgs,
  buildUnshieldArgs,
  buildPrivateSwapArgs,
  readReserves,
} from "../src/chain";

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

describe("chain: buildUnshieldArgs", () => {
  it("produces 9 args matching unshield(a,b,c,root,nullifier,amount,recipient,recipient_field,fee)", () => {
    const args = buildUnshieldArgs({
      a: hex(64),
      b: hex(128),
      c: hex(64),
      root: hex(32),
      nullifier: hex(32),
      withdrawAmount: 1000n,
      recipient: Keypair.random().publicKey(),
      recipientField: hex(32),
      fee: 0n,
    });
    expect(args).to.have.length(9);
    expect(args[0].bytes()).to.have.length(64); // a
    expect(args[1].bytes()).to.have.length(128); // b
    expect(args[2].bytes()).to.have.length(64); // c
    expect(args[3].bytes()).to.have.length(32); // root
    expect(args[4].bytes()).to.have.length(32); // nullifier
    expect(args[5].switch()).to.equal(xdr.ScValType.scvI128()); // amount
    expect(args[6].switch()).to.equal(xdr.ScValType.scvAddress()); // recipient
    expect(args[7].bytes()).to.have.length(32); // recipient_field
    expect(args[8].switch()).to.equal(xdr.ScValType.scvI128()); // fee
  });
});

describe("chain: buildPrivateSwapArgs", () => {
  it("produces 12 args with asset_out as u32 and reserves as i128", () => {
    const args = buildPrivateSwapArgs({
      a: hex(64),
      b: hex(128),
      c: hex(64),
      nullifierIn: hex(32),
      outCommitment: hex(32),
      changeCommitment: hex(32),
      reserveInBefore: 1000000n,
      reserveOutBefore: 1000000n,
      reserveInAfter: 1250000n,
      reserveOutAfter: 800000n,
      assetOut: 0,
      fee: 0n,
    });
    expect(args).to.have.length(12);
    expect(args[3].bytes()).to.have.length(32); // nullifier_in
    expect(args[4].bytes()).to.have.length(32); // out_commitment
    expect(args[5].bytes()).to.have.length(32); // change_commitment
    expect(args[6].switch()).to.equal(xdr.ScValType.scvI128());
    expect(args[10].switch()).to.equal(xdr.ScValType.scvU32()); // asset_out
    expect(scValToNative(args[10])).to.equal(0);
    expect(args[11].switch()).to.equal(xdr.ScValType.scvI128()); // fee
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

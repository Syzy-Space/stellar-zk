import { expect } from "chai";
import * as fs from "fs";
import * as snarkjs from "snarkjs";
import { proveShield, close } from "../src/prover";
import { SHIELD_VKEY } from "../src/config";

describe("prover", function () {
  this.timeout(120000);

  after(() => {
    close();
  });

  it("proveShield produces a proof that snarkjs.groth16.verify accepts", async () => {
    const result = await proveShield({
      amount: 1000n,
      ownerPk: 7n,
      rho: 42n,
    });

    // Encoded proof shapes.
    expect(result.a).to.have.length(128);
    expect(result.b).to.have.length(256);
    expect(result.c).to.have.length(128);
    result.publicInputs.forEach((pi) => expect(pi).to.have.length(64));

    // Public inputs: [amount, commitment].
    expect(result.publicSignals[0]).to.equal("1000");
    expect(BigInt("0x" + result.publicInputs[1])).to.equal(result.commitment);

    // Real end-to-end verification against the shield vkey.
    const vkey = JSON.parse(fs.readFileSync(SHIELD_VKEY, "utf8"));
    const ok = await snarkjs.groth16.verify(
      vkey,
      result.publicSignals,
      result.proof
    );
    expect(ok).to.equal(true);
  });
});

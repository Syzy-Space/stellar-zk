# Syzy Shielded — Groth16 Trusted-Setup Ceremony

## Phase 1 (universal / Powers of Tau)

- Source: `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau`
- Power used: **2^14** (16384 constraints) for **all three circuits**.
  - Constraint counts: `shield` = 546, `unshield` = 5629, `private_swap` = 6474 non-linear
    constraints — all comfortably under 2^14, so no bump to 2^15/2^16 was needed.

## Phase 2 (per-circuit) contributors

Two contributions were applied to each circuit's zkey:

1. **Contributor 1**
2. **Contributor 2**

(Reproduce via `bash circuits/ceremony/setup.sh`.)

## `zkey verify` results

| Circuit        | Result    |
| -------------- | --------- |
| shield         | ZKey Ok!  |
| unshield       | ZKey Ok!  |
| private_swap   | ZKey Ok!  |

## Final verification-key sha256

```
543fa399928662dc845036a44038e9e8df2a51f5cef4e924e97660f15aa83aa1  private_swap.vkey.json
5890c0d33b8870254f04c3f2a7baa0e06b31ee6a13f3c7ca34ce5d57874126cb  shield.vkey.json
e1963d48661fe83fe172e456c148162f18a745408400977ca73705ec91f9a1ae  unshield.vkey.json
```

## Honest note

This is a real small multi-contributor ceremony for the PoC. A broad public MPC ceremony gates any mainnet use.

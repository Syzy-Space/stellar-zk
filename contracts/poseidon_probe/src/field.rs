//! Minimal no_std BN254 scalar field (Fr) in Montgomery form.
//! r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
//! Representation: [u64;4] little-endian limbs, Montgomery form (a*R mod r, R=2^256).
//! Only the ops Poseidon needs: add, sub, mul (CIOS Montgomery), pow5, from/to bytes.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fr(pub [u64; 4]);

// Modulus r (LE limbs), non-Montgomery.
pub const MODULUS: [u64; 4] = [
    0x43e1f593f0000001,
    0x2833e84879b97091,
    0xb85045b68181585d,
    0x30644e72e131a029,
];

// -r^{-1} mod 2^64 (Montgomery). For BN254 Fr this is the standard INV.
const INV: u64 = 0xc2e1f593efffffff;

// R^2 mod r, Montgomery, LE limbs. Standard ark-bn254 value.
const R2: [u64; 4] = [
    0x1bb8e645ae216da7,
    0x53fe3ab1e35c59e3,
    0x8c49833d53bb8085,
    0x0216d0b17f4e44a5,
];

#[inline(always)]
fn mac(a: u64, b: u64, c: u64, carry: u64) -> (u64, u64) {
    let ret = (a as u128) + (b as u128) * (c as u128) + (carry as u128);
    (ret as u64, (ret >> 64) as u64)
}
#[inline(always)]
fn adc(a: u64, b: u64, carry: u64) -> (u64, u64) {
    let ret = (a as u128) + (b as u128) + (carry as u128);
    (ret as u64, (ret >> 64) as u64)
}
#[inline(always)]
fn sbb(a: u64, b: u64, borrow: u64) -> (u64, u64) {
    let ret = (a as u128).wrapping_sub((b as u128) + ((borrow >> 63) as u128));
    (ret as u64, (ret >> 64) as u64)
}

impl Fr {
    pub const fn zero() -> Self { Fr([0, 0, 0, 0]) }

    fn sub_noreduce(&self, rhs: &Fr) -> Fr {
        let (d0, b) = sbb(self.0[0], rhs.0[0], 0);
        let (d1, b) = sbb(self.0[1], rhs.0[1], b);
        let (d2, b) = sbb(self.0[2], rhs.0[2], b);
        let (d3, b) = sbb(self.0[3], rhs.0[3], b);
        // if borrow, add modulus back
        let (d0, c) = adc(d0, MODULUS[0] & b, 0);
        let (d1, c) = adc(d1, MODULUS[1] & b, c);
        let (d2, c) = adc(d2, MODULUS[2] & b, c);
        let (d3, _) = adc(d3, MODULUS[3] & b, c);
        Fr([d0, d1, d2, d3])
    }

    pub fn add(&self, rhs: &Fr) -> Fr {
        let (d0, c) = adc(self.0[0], rhs.0[0], 0);
        let (d1, c) = adc(self.0[1], rhs.0[1], c);
        let (d2, c) = adc(self.0[2], rhs.0[2], c);
        let (d3, _) = adc(self.0[3], rhs.0[3], c);
        // conditional subtract modulus
        Fr([d0, d1, d2, d3]).sub_modulus_if_ge()
    }

    fn sub_modulus_if_ge(&self) -> Fr {
        let (r0, b) = sbb(self.0[0], MODULUS[0], 0);
        let (r1, b) = sbb(self.0[1], MODULUS[1], b);
        let (r2, b) = sbb(self.0[2], MODULUS[2], b);
        let (r3, b) = sbb(self.0[3], MODULUS[3], b);
        // if borrow (b==all ones) -> keep original, else use reduced
        let mask = b; // 0xFFFF..FF if self<modulus (borrow), else 0
        Fr([
            (self.0[0] & mask) | (r0 & !mask),
            (self.0[1] & mask) | (r1 & !mask),
            (self.0[2] & mask) | (r2 & !mask),
            (self.0[3] & mask) | (r3 & !mask),
        ])
    }

    pub fn sub(&self, rhs: &Fr) -> Fr { self.sub_noreduce(rhs) }

    // CIOS Montgomery multiplication.
    pub fn mul(&self, rhs: &Fr) -> Fr {
        let a = &self.0;
        let b = &rhs.0;
        let mut t = [0u64; 5];
        for i in 0..4 {
            // t += a * b[i]
            let mut carry = 0u64;
            let (v, c) = mac(t[0], a[0], b[i], carry); t[0] = v; carry = c;
            let (v, c) = mac(t[1], a[1], b[i], carry); t[1] = v; carry = c;
            let (v, c) = mac(t[2], a[2], b[i], carry); t[2] = v; carry = c;
            let (v, c) = mac(t[3], a[3], b[i], carry); t[3] = v; carry = c;
            let (v, c) = adc(t[4], 0, carry); t[4] = v; let carry_out = c;

            let m = t[0].wrapping_mul(INV);
            let (_, c) = mac(t[0], m, MODULUS[0], 0); carry = c;
            let (v, c) = mac(t[1], m, MODULUS[1], carry); t[0] = v; carry = c;
            let (v, c) = mac(t[2], m, MODULUS[2], carry); t[1] = v; carry = c;
            let (v, c) = mac(t[3], m, MODULUS[3], carry); t[2] = v; carry = c;
            let (v, c) = adc(t[4], carry, 0); t[3] = v;
            t[4] = carry_out + c;
        }
        Fr([t[0], t[1], t[2], t[3]]).sub_modulus_if_ge()
    }

    pub fn square(&self) -> Fr { self.mul(self) }

    pub fn pow5(&self) -> Fr {
        let x2 = self.square();
        let x4 = x2.square();
        x4.mul(self)
    }

    // Convert 32-byte big-endian (canonical, <r) into Montgomery Fr.
    pub fn from_be_bytes(bytes: &[u8; 32]) -> Fr {
        let mut limbs = [0u64; 4];
        // bytes[0..8] is most significant -> limb[3]
        for i in 0..4 {
            let mut v = 0u64;
            for j in 0..8 {
                v = (v << 8) | bytes[i * 8 + j] as u64;
            }
            limbs[3 - i] = v;
        }
        // to Montgomery: mul by R^2
        Fr(limbs).mul(&Fr(R2))
    }

    // Convert Montgomery Fr to canonical 32-byte big-endian.
    pub fn to_be_bytes(&self) -> [u8; 32] {
        // Montgomery reduce with multiplier 1 -> canonical
        let one = Fr([1, 0, 0, 0]);
        let canon = self.mul(&one); // a*R * 1 * R^-1 = a
        let mut out = [0u8; 32];
        for i in 0..4 {
            let limb = canon.0[3 - i];
            for j in 0..8 {
                out[i * 8 + j] = (limb >> (56 - 8 * j)) as u8;
            }
        }
        out
    }
}

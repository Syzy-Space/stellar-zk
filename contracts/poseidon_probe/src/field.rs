//! Minimal BN254 scalar field (Fr) in pure no_std Rust.
//!
//! Values are held in Montgomery form: the internal limbs represent `a * R mod r`
//! where `R = 2^256`. Little-endian `[u64; 4]` limbs.
//!
//! r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
//!
//! Only what Poseidon needs: add, sub, mul (Montgomery CIOS), pow5 (S-box), and
//! canonical <-> Montgomery <-> big-endian-bytes conversions.

/// Modulus r, little-endian limbs (canonical form).
const MODULUS: [u64; 4] = [
    0x43e1f593f0000001,
    0x2833e84879b97091,
    0xb85045b68181585d,
    0x30644e72e131a029,
];

/// R^2 mod r (Montgomery), used to convert canonical -> Montgomery.
const R2: [u64; 4] = [
    0x1bb8e645ae216da7,
    0x53fe3ab1e35c59e3,
    0x8c49833d53bb8085,
    0x0216d0b17f4e44a5,
];

/// -r^{-1} mod 2^64 (Montgomery reduction parameter).
const INV: u64 = 0xc2e1f593efffffff;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Fr(pub [u64; 4]);

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

/// Returns (a - b - borrow_in, borrow_out) where borrow is 0 or 1.
#[inline(always)]
fn sbb(a: u64, b: u64, borrow: u64) -> (u64, u64) {
    let ret = (a as u128).wrapping_sub((b as u128) + (borrow as u128));
    (ret as u64, ((ret >> 64) as u64) & 1)
}

impl Fr {
    pub const ZERO: Fr = Fr([0, 0, 0, 0]);

    /// Subtract modulus if self >= modulus (single conditional reduction).
    #[inline(always)]
    fn conditional_reduce(r: [u64; 4]) -> [u64; 4] {
        let (d0, b) = sbb(r[0], MODULUS[0], 0);
        let (d1, b) = sbb(r[1], MODULUS[1], b);
        let (d2, b) = sbb(r[2], MODULUS[2], b);
        let (d3, b) = sbb(r[3], MODULUS[3], b);
        // b == 1 means r < modulus -> keep r; b == 0 means use subtracted value.
        if b == 1 {
            r
        } else {
            [d0, d1, d2, d3]
        }
    }

    #[inline]
    pub fn add(&self, other: &Fr) -> Fr {
        let a = &self.0;
        let b = &other.0;
        let (r0, c) = adc(a[0], b[0], 0);
        let (r1, c) = adc(a[1], b[1], c);
        let (r2, c) = adc(a[2], b[2], c);
        let (r3, _c) = adc(a[3], b[3], c);
        // a,b < r < 2^254, so sum < 2r < 2^256 (no overflow); one reduction suffices.
        Fr(Self::conditional_reduce([r0, r1, r2, r3]))
    }

    #[inline]
    #[allow(dead_code)] // provided for completeness / reuse by the pool contract
    pub fn sub(&self, other: &Fr) -> Fr {
        let a = &self.0;
        let b = &other.0;
        let (r0, brw) = sbb(a[0], b[0], 0);
        let (r1, brw) = sbb(a[1], b[1], brw);
        let (r2, brw) = sbb(a[2], b[2], brw);
        let (r3, brw) = sbb(a[3], b[3], brw);
        // If borrow, add modulus back.
        let mask = brw.wrapping_neg(); // 0 or 0xffff...ffff
        let (r0, c) = adc(r0, MODULUS[0] & mask, 0);
        let (r1, c) = adc(r1, MODULUS[1] & mask, c);
        let (r2, c) = adc(r2, MODULUS[2] & mask, c);
        let (r3, _c) = adc(r3, MODULUS[3] & mask, c);
        Fr([r0, r1, r2, r3])
    }

    /// Montgomery multiplication (CIOS): returns self*other*R^{-1} mod r.
    #[inline]
    pub fn mul(&self, other: &Fr) -> Fr {
        let a = &self.0;
        let b = &other.0;
        let mut t = [0u64; 5];

        let mut i = 0;
        while i < 4 {
            // t += a * b[i]
            let (lo, mut carry) = mac(t[0], a[0], b[i], 0);
            t[0] = lo;
            let (lo, cc) = mac(t[1], a[1], b[i], carry);
            t[1] = lo;
            carry = cc;
            let (lo, cc) = mac(t[2], a[2], b[i], carry);
            t[2] = lo;
            carry = cc;
            let (lo, cc) = mac(t[3], a[3], b[i], carry);
            t[3] = lo;
            carry = cc;
            let (lo, cc) = adc(t[4], 0, carry);
            t[4] = lo;
            let c2 = cc;

            // m = t[0] * INV mod 2^64
            let m = t[0].wrapping_mul(INV);
            // t += m * MODULUS; then shift right by one limb (t[0] cancels to 0).
            let (_lo, mut carry) = mac(t[0], m, MODULUS[0], 0);
            let (lo, cc) = mac(t[1], m, MODULUS[1], carry);
            t[0] = lo;
            carry = cc;
            let (lo, cc) = mac(t[2], m, MODULUS[2], carry);
            t[1] = lo;
            carry = cc;
            let (lo, cc) = mac(t[3], m, MODULUS[3], carry);
            t[2] = lo;
            carry = cc;
            let (lo, cc) = adc(t[4], carry, 0);
            t[3] = lo;
            t[4] = cc.wrapping_add(c2);

            i += 1;
        }

        // Final reduction. t[4] may be 0 or 1.
        let mut r = [t[0], t[1], t[2], t[3]];
        if t[4] != 0 {
            let (d0, brw) = sbb(r[0], MODULUS[0], 0);
            let (d1, brw) = sbb(r[1], MODULUS[1], brw);
            let (d2, brw) = sbb(r[2], MODULUS[2], brw);
            let (d3, _brw) = sbb(r[3], MODULUS[3], brw);
            r = [d0, d1, d2, d3];
        }
        Fr(Self::conditional_reduce(r))
    }

    /// x^5 (Poseidon S-box).
    #[inline]
    pub fn pow5(&self) -> Fr {
        let x2 = self.mul(self);
        let x4 = x2.mul(&x2);
        x4.mul(self)
    }

    /// Convert a canonical big-endian 32-byte value into a Montgomery-form Fr
    /// (reduced mod r).
    pub fn from_be_bytes(bytes: &[u8; 32]) -> Fr {
        let mut limbs = [0u64; 4];
        let mut i = 0;
        while i < 4 {
            let mut w = 0u64;
            let mut j = 0;
            while j < 8 {
                w = (w << 8) | (bytes[i * 8 + j] as u64);
                j += 1;
            }
            // bytes[0..8] are most-significant -> limb index 3.
            limbs[3 - i] = w;
            i += 1;
        }
        // Multiplying canonical limbs by R2 in Montgomery form yields value*R mod r,
        // and the CIOS reduction handles input >= r (input < 2^256 always holds).
        Fr(limbs).mul(&Fr(R2))
    }

    /// Convert Montgomery-form Fr back to canonical big-endian 32 bytes.
    pub fn to_be_bytes(&self) -> [u8; 32] {
        // self * 1 * R^{-1} = canonical value.
        let canonical = self.mul(&Fr([1, 0, 0, 0]));
        let l = canonical.0;
        let mut out = [0u8; 32];
        let mut i = 0;
        while i < 4 {
            let w = l[3 - i];
            let mut j = 0;
            while j < 8 {
                out[i * 8 + j] = (w >> (56 - 8 * j)) as u8;
                j += 1;
            }
            i += 1;
        }
        out
    }
}

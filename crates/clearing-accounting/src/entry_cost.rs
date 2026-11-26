//! RVPROF03: outward-rounded bounds on total scaled cost at the last increase.
//! Reductions retain the same reference, so splitting a reduction cannot compound rounding.
use crate::attribution::Attribution;
use crate::{Error, Result, MAX_LOTS, MAX_PRICE, MAX_SCALED, SCALE};

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct EntryCost {
    lower: u128,
    upper: u128,
    reference_lots: u64,
}

impl EntryCost {
    pub const BYTES: usize = 40;

    pub fn read(slot: &[u8], lots: i64) -> Result<Self> {
        if slot.len() < Self::BYTES || slot[Self::BYTES..].iter().any(|b| *b != 0) {
            return Err(Error::Bounds);
        }
        let cost = Self {
            lower: u128::from_le_bytes(slot[..16].try_into().unwrap()),
            upper: u128::from_le_bytes(slot[16..32].try_into().unwrap()),
            reference_lots: u64::from_le_bytes(slot[32..40].try_into().unwrap()),
        };
        cost.validate(lots)?;
        Ok(cost)
    }

    pub fn write(&self, slot: &mut [u8]) -> Result<()> {
        if slot.len() < Self::BYTES {
            return Err(Error::Bounds);
        }
        slot[..16].copy_from_slice(&self.lower.to_le_bytes());
        slot[16..32].copy_from_slice(&self.upper.to_le_bytes());
        slot[32..40].copy_from_slice(&self.reference_lots.to_le_bytes());
        slot[40..].fill(0);
        Ok(())
    }

    pub(crate) fn validate(&self, lots: i64) -> Result<()> {
        let reference = u128::from(self.reference_lots);
        if lots == 0 {
            return if *self == Self::default() {
                Ok(())
            } else {
                Err(Error::Invariant)
            };
        }
        if self.reference_lots < lots.unsigned_abs()
            || self.reference_lots > MAX_LOTS as u64
            || self.lower < reference * SCALE as u128
            || self.upper < self.lower
            || self.upper > reference * u128::from(MAX_PRICE) * SCALE as u128
            || self.upper - self.lower > 2 * reference
        {
            return Err(Error::Bounds);
        }
        Ok(())
    }

    pub fn fill(&self, before: i64, after: i64, gross: u64) -> Result<Self> {
        self.validate(before)?;
        let traded = before.abs_diff(after);
        if traded == 0
            || traded > MAX_LOTS as u64
            || after.unsigned_abs() > MAX_LOTS as u64
            || gross < traded
            || gross > traded * MAX_PRICE
        {
            return Err(Error::Bounds);
        }
        if after == 0 {
            return Ok(Self::default());
        }
        let gross = u128::from(gross) * SCALE as u128;
        let updated = if before.signum() != after.signum() {
            // On a flip the entire execution is the reference for the newly opened part.
            Self {
                lower: gross,
                upper: gross,
                reference_lots: traded,
            }
        } else if after.unsigned_abs() < before.unsigned_abs() {
            *self
        } else {
            let held = u128::from(before.unsigned_abs());
            let reference = u128::from(self.reference_lots);
            // In the validated domain each numerator is <= 10^31.
            Self {
                lower: gross + self.lower * held / reference,
                upper: gross + (self.upper * held).div_ceil(reference),
                reference_lots: after.unsigned_abs(),
            }
        };
        updated.validate(after)?;
        Ok(updated)
    }

    pub fn ordinary_cap(&self, lots: i64, mark: u64, claim: i128) -> Result<u64> {
        self.validate(lots)?;
        if !(1..=MAX_PRICE).contains(&mark) || claim.unsigned_abs() > MAX_SCALED as u128 {
            return Err(Error::Bounds);
        }
        if claim <= 0 {
            return Ok(0);
        }
        if lots == 0 {
            return u64::try_from(claim / SCALE).map_err(|_| Error::Overflow);
        }
        // Greatest possible surviving gain gives the smallest eligible closed claim.
        let reference = i128::from(self.reference_lots);
        let endpoint = if lots > 0 { self.lower } else { self.upper } as i128;
        let gain = (i128::from(lots) * (i128::from(mark) * SCALE * reference - endpoint)).max(0);
        u64::try_from((claim * reference - gain).max(0) / (SCALE * reference))
            .map_err(|_| Error::Overflow)
    }

    /// Only for frozen charge/ranking. Existing verifiers consume canonical
    /// per-lot fractions; use the endpoint giving the smallest seizable gain.
    pub fn frozen_basis(&self, lots: i64) -> Result<Attribution> {
        self.validate(lots)?;
        if lots == 0 {
            return Ok(Attribution::default());
        }
        Ok(Attribution::from_scaled_basis(
            if lots > 0 { self.upper } else { self.lower },
            self.reference_lots,
        ))
    }
}

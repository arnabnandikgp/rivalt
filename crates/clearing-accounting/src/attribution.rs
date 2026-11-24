//! Exact entry and previously paid profit per surviving lot, in scaled collateral
//! atoms. Both numerators share one positive denominator. The associated clearing
//! position supplies signed lots. A partial reduction needs no arithmetic or growth.
use crate::{Error, Result, MAX_LOTS, MAX_PRICE, SCALE};
use num_bigint::{BigInt, BigUint, Sign};
use num_integer::Integer;
use num_traits::{One, ToPrimitive, Zero};

mod forced_close;
pub use forced_close::{FrozenCapacity, LotRate, PairedLots};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attribution {
    entry: BigUint,
    paid: BigUint,
    denominator: BigUint,
}

impl Default for Attribution {
    fn default() -> Self {
        Self {
            entry: BigUint::zero(),
            paid: BigUint::zero(),
            denominator: BigUint::one(),
        }
    }
}

impl Attribution {
    fn reduced(entry: BigUint, paid: BigUint, denominator: BigUint) -> Self {
        let divisor = entry.gcd(&denominator).gcd(&paid);
        if divisor.is_one() {
            return Self {
                entry,
                paid,
                denominator,
            };
        }
        Self {
            entry: entry / &divisor,
            paid: paid / &divisor,
            denominator: denominator / divisor,
        }
    }

    pub fn fill(&self, before: i64, after: i64, gross: u64) -> Result<Self> {
        let quantity = before.abs_diff(after);
        if quantity == 0
            || gross == 0
            || before.unsigned_abs() > MAX_LOTS as u64
            || after.unsigned_abs() > MAX_LOTS as u64
            || quantity > MAX_LOTS as u64
            || self.entry.is_zero() != (before == 0)
        {
            return Err(Error::Bounds);
        }
        if after == 0 {
            return Ok(Self::default());
        }
        let gross = BigUint::from(u128::from(gross) * SCALE as u128);
        if before.signum() != after.signum() {
            // A trader's atomic route uses the exact aggregate execution price;
            // each independent maker capital uses its own leg's gross and lots.
            return Ok(Self::reduced(gross, BigUint::zero(), quantity.into()));
        }
        if after.unsigned_abs() < before.unsigned_abs() {
            return Ok(self.clone());
        }
        Ok(Self::reduced(
            &self.entry * before.unsigned_abs() + gross * &self.denominator,
            &self.paid * before.unsigned_abs(),
            &self.denominator * after.unsigned_abs(),
        ))
    }

    fn price_profit(&self, lots: i64, mark: u64) -> BigInt {
        let marked = BigUint::from(u128::from(mark) * SCALE as u128) * &self.denominator;
        (BigInt::from(marked) - BigInt::from(self.entry.clone())) * lots
    }

    /// Ordinary price-profit ceiling for fresh positions with no earlier open-price payments.
    /// The accrued claim includes funding and prior settlement. Exclude positive
    /// price P&L on surviving lots, then floor once at the whole-atom boundary.
    /// The caller still supplies backing, available pool and whole-account admission.
    pub fn closed_quantity_payment_cap(
        &self,
        lots: i64,
        mark: u64,
        claim_scaled: i128,
    ) -> Result<u64> {
        if !self.paid.is_zero() || self.entry.is_zero() != (lots == 0) {
            return Err(Error::Invariant);
        }
        if mark == 0 || mark > MAX_PRICE || lots.unsigned_abs() > MAX_LOTS as u64 {
            return Err(Error::Bounds);
        }
        let denominator = BigInt::from(self.denominator.clone());
        let open_gain = self.price_profit(lots, mark).max(BigInt::zero());
        let eligible = (BigInt::from(claim_scaled) * &denominator - open_gain).max(BigInt::zero());
        (eligible / (denominator * SCALE))
            .to_u64()
            .ok_or(Error::Overflow)
    }

    /// Apply an already admitted backed payment at the same mark and fully accrued
    /// claim as clearing. Negative fixed P&L never enlarges the available payment.
    pub fn payment(&self, lots: i64, mark: u64, claim_scaled: i128, amount: u64) -> Result<Self> {
        let payment = i128::from(amount) * SCALE;
        if mark == 0
            || amount == 0
            || claim_scaled < payment
            || lots.unsigned_abs() > MAX_LOTS as u64
            || self.entry.is_zero() != (lots == 0)
        {
            return Err(Error::Entitlement);
        }
        if lots == 0 {
            return Ok(self.clone());
        }
        let quantity = lots.unsigned_abs();
        let denominator = BigInt::from(self.denominator.clone());
        let open = self.price_profit(lots, mark) - BigInt::from(&self.paid * quantity);
        let fixed = BigInt::from(claim_scaled) * &denominator - open;
        let assigned = BigInt::from(payment) * &denominator - fixed.max(BigInt::zero());
        if assigned.sign() != Sign::Plus {
            return Ok(self.clone());
        }
        Ok(Self::reduced(
            &self.entry * quantity,
            &self.paid * quantity + assigned.magnitude(),
            &self.denominator * quantity,
        ))
    }

    /// D112/D113 intersection of the per-lot execution bound, unpaid open gain
    /// on the selected lots, and the whole account's positive claim in this market.
    pub fn charge_cap(
        &self,
        lots: i64,
        mark: u64,
        claim_scaled: i128,
        matched: u64,
    ) -> Result<u64> {
        self.paired_lots(lots, mark, claim_scaled, matched, 0)
            .map(|plan| plan.eligible)
    }

    /// Pre-fund all monotonically reducing lot counts and any interleaved
    /// ordinary gain payments. The derivation lives in default-plan-verification.md.
    pub fn recovery_bytes(&self, lots: i64) -> Result<usize> {
        let quantity = lots.unsigned_abs();
        if quantity > MAX_LOTS as u64 || self.entry.is_zero() != (quantity == 0) {
            return Err(Error::Bounds);
        }
        if quantity == 0 {
            return Ok(0);
        }
        let extra_bits = 2 * quantity.next_power_of_two() - 2;
        let largest_payment = (&self.denominator * (u128::from(MAX_PRICE) * SCALE as u128))
            .max(self.entry.clone())
            .max(self.paid.clone());
        let mut total = 6usize;
        for width in [
            self.entry.bits(),
            largest_payment.bits(),
            self.denominator.bits(),
        ] {
            let bytes =
                usize::try_from((width + extra_bits).div_ceil(8)).map_err(|_| Error::Overflow)?;
            if bytes > usize::from(u16::MAX) {
                return Err(Error::Bounds);
            }
            total = total.checked_add(bytes).ok_or(Error::Overflow)?;
        }
        Ok(total)
    }

    /// Flat is all zeros. An open record is three little-endian u16 lengths,
    /// then minimal unsigned little-endian magnitudes, then zero capacity.
    pub fn write(&self, bytes: &mut [u8]) -> Result<()> {
        if self.entry.is_zero() {
            bytes.fill(0);
            return Ok(());
        }
        let numbers = [&self.entry, &self.paid, &self.denominator];
        let lengths =
            numbers.map(|value| usize::try_from(value.bits().div_ceil(8)).unwrap_or(usize::MAX));
        let end = lengths
            .iter()
            .try_fold(6usize, |sum, size| sum.checked_add(*size))
            .ok_or(Error::Overflow)?;
        if end > bytes.len() || lengths.iter().any(|size| *size > usize::from(u16::MAX)) {
            return Err(Error::Bounds);
        }
        let mut cursor = 6;
        for (index, (value, size)) in numbers.into_iter().zip(lengths).enumerate() {
            bytes[2 * index..2 * index + 2].copy_from_slice(&(size as u16).to_le_bytes());
            if size != 0 {
                bytes[cursor..cursor + size].copy_from_slice(&value.to_bytes_le());
                cursor += size;
            }
        }
        bytes[cursor..].fill(0);
        Ok(())
    }

    pub fn read(bytes: &[u8], lots: i64) -> Result<Self> {
        if lots == 0 {
            if bytes.iter().any(|byte| *byte != 0) {
                return Err(Error::Invariant);
            }
            return Ok(Self::default());
        }
        if bytes.len() < 6 || lots.unsigned_abs() > MAX_LOTS as u64 {
            return Err(Error::Bounds);
        }
        let mut cursor = 6;
        let mut number = |index: usize| -> Result<BigUint> {
            let size = u16::from_le_bytes([bytes[index * 2], bytes[index * 2 + 1]]) as usize;
            let raw = bytes.get(cursor..cursor + size).ok_or(Error::Bounds)?;
            if raw.last() == Some(&0) {
                return Err(Error::Invariant);
            }
            cursor += size;
            Ok(BigUint::from_bytes_le(raw))
        };
        let entry = number(0)?;
        let paid = number(1)?;
        let denominator = number(2)?;
        if entry.is_zero() || denominator.is_zero() || bytes[cursor..].iter().any(|byte| *byte != 0)
        {
            return Err(Error::Invariant);
        }
        // Only clearing writes this account, always through reduced(). Canonicality
        // is checked here too so malformed checkpoints cannot become financial input.
        if !entry.gcd(&denominator).gcd(&paid).is_one() {
            return Err(Error::Invariant);
        }
        Ok(Self {
            entry,
            paid,
            denominator,
        })
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;

    #[test]
    fn partial_reduction_keeps_the_paid_share_and_clears_on_a_flip() {
        let position = Attribution::default().fill(0, -3, 330).unwrap();
        let paid = position.payment(-3, 100, 30 * SCALE, 14).unwrap();
        let partial = paid.fill(-3, -2, 101).unwrap();
        assert_eq!(partial, paid);
        let increased = partial.fill(-2, -3, 104).unwrap();
        for (matched, cap) in [0, 4, 9, 14].into_iter().enumerate() {
            assert_eq!(
                increased.charge_cap(-3, 100, 50 * SCALE, matched as u64),
                Ok(cap)
            );
        }
        assert_eq!(
            increased.fill(-3, 2, 495).unwrap(),
            Attribution::default().fill(0, 2, 198).unwrap()
        );
        assert_eq!(increased.fill(-3, 0, 300).unwrap(), Attribution::default());
    }

    #[test]
    fn closed_claims_are_paid_first_including_fractional_funding() {
        let open = Attribution::default().fill(0, 2, 180).unwrap();
        let unchanged = open.payment(2, 100, 25 * SCALE + SCALE / 2, 5).unwrap();
        assert_eq!(unchanged, open);
        let paid = open.payment(2, 100, 25 * SCALE + SCALE / 2, 7).unwrap();
        assert_eq!(paid.paid, BigUint::from(750_000_000u64)); // (7 - 5.5)/2 per lot
        assert_eq!(paid.charge_cap(2, 100, 100 * SCALE, 2), Ok(18));
        assert_eq!(open.payment(2, 100, SCALE / 2, 1), Err(Error::Entitlement));
    }

    #[test]
    fn exact_near_tick_histories_and_recovery_capacity() {
        for (initial, expected) in [(99, 2), (101, 1)] {
            let mut state = Attribution::default().fill(0, 1, initial).unwrap();
            for _ in 0..256 {
                state = state.fill(1, 2, 100).unwrap().fill(2, 1, 100).unwrap();
            }
            assert!(state.denominator.bits() > 128);
            assert_eq!(state.charge_cap(1, 102, 4 * SCALE, 1), Ok(expected));
            let mut storage = [0u8; 160];
            let size = state.recovery_bytes(1).unwrap();
            state.write(&mut storage[..size]).unwrap();
            assert_eq!(Attribution::read(&storage[..size], 1).unwrap(), state);
            let mut short = [3u8; 12];
            assert!(state.write(&mut short).is_err());
            assert_eq!(short, [3; 12]);
        }
    }

    #[test]
    fn every_intervening_payment_fits_the_original_admission() {
        for side in [1, -1] {
            for initial in 1..=64i64 {
                let mut value = Attribution::default()
                    .fill(0, side * initial, 100 * initial as u64 + 1)
                    .unwrap();
                let capacity = value.recovery_bytes(side * initial).unwrap();
                let mut bytes = std::vec![0;capacity];
                for quantity in (1..=initial).rev() {
                    let lots = side * quantity;
                    let mark = if side > 0 { 200 } else { 5 };
                    // Positive/negative fixed claims, including scaled fractional atoms.
                    for claim in [3 * SCALE, (quantity as i128) * 90 * SCALE + SCALE / 3] {
                        value = value.payment(lots, mark, claim, 2).unwrap();
                        value.write(&mut bytes).unwrap();
                        assert_eq!(Attribution::read(&bytes, lots).unwrap(), value);
                    }
                    value = value.fill(lots, lots - side, mark).unwrap();
                }
                assert_eq!(value, Attribution::default());
            }
        }
    }
}

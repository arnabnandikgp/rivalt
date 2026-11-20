//! Sufficient D117/D118 protection when every possible whole-atom rounding
//! on the adjusted book preserves every original creditor's rounded minimum.
use financial_core::{Error, Result, SCALE};
use num_bigint::BigUint;
use num_integer::Integer;
use num_traits::Zero;

pub struct PaymentRates {
    pub numerators: [BigUint; 2],
    pub denominator: BigUint,
}

impl PaymentRates {
    pub fn new(numerators: [BigUint; 2], denominator: BigUint) -> Result<Self> {
        if denominator.is_zero() || numerators.iter().any(|n| n > &denominator) {
            return Err(Error::Bounds);
        }
        Ok(Self {
            numerators,
            denominator,
        })
    }

    /// Original loss minus adjusted loss equals the charged principal plus
    /// the change in gross market payment. Retaining gross payment proves the
    /// recovery ceiling was reached. Insurance protection is market-specific.
    pub fn full_recovery(
        &self,
        adjusted: &Self,
        positive_scaled: [BigUint; 2],
        charge: [u128; 2],
        original_spent: [u64; 2],
        adjusted_spent: [u64; 2],
    ) -> Result<()> {
        for market in 0..2 {
            let face = &positive_scaled[market];
            let reduction = BigUint::from(charge[market]) * SCALE as u128;
            if &reduction > face {
                return Err(Error::Cohort);
            }
            let after = (face - reduction) * &adjusted.numerators[market] * &self.denominator;
            let before = face * &self.numerators[market] * &adjusted.denominator;
            if after < before
                || (charge[1 - market] != 0 && adjusted_spent[market] > original_spent[market])
            {
                return Err(Error::Entitlement);
            }
        }
        Ok(())
    }

    /// A creditor can receive at most ceil(original exact payment) in the
    /// baseline. It receives at least floor(adjusted exact payment) under all
    /// conserving adjusted roundings. Only its own direct charge is allowed.
    pub fn protects_row(
        &self,
        adjusted: &Self,
        before: [i128; 2],
        after: [i128; 2],
        changed: [bool; 2],
    ) -> Result<()> {
        for market in 0..2 {
            if !changed[1 - market] || before[market] <= 0 {
                continue;
            }
            let face = before[market] as u128;
            let effective = u128::try_from(after[market]).map_err(|_| Error::Cohort)?;
            let change = face.checked_sub(effective).ok_or(Error::Cohort)?;
            if change % SCALE as u128 != 0 {
                return Err(Error::Cohort);
            }
            let original_bound =
                (&self.numerators[market] * face).div_ceil(&(&self.denominator * SCALE as u128));
            let lower_adjusted = (&adjusted.numerators[market] * effective)
                / (&adjusted.denominator * SCALE as u128);
            if lower_adjusted + change / (SCALE as u128) < original_bound {
                return Err(Error::Entitlement);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rates(a: u64, b: u64, den: u64) -> PaymentRates {
        PaymentRates::new([a.into(), b.into()], den.into()).unwrap()
    }

    #[test]
    fn payment_growth_must_recover_every_atom_in_both_markets() {
        // Original faces of 12 and 8 pay 6 and 4. Removing 4 and 2 atoms
        // produces new faces of 8 and 6. Their rates must pay at least 6/4.
        let original = rates(1, 1, 2);
        let exact = rates(9, 8, 12);
        let inputs = || {
            [
                BigUint::from(12 * SCALE as u128),
                BigUint::from(8 * SCALE as u128),
            ]
        };
        assert!(original
            .full_recovery(&exact, inputs(), [4, 2], [1, 2], [1, 2])
            .is_ok());
        assert!(original
            .full_recovery(&rates(9, 7, 12), inputs(), [4, 2], [1, 2], [1, 2])
            .is_err());
        assert!(original
            .full_recovery(&exact, inputs(), [4, 2], [1, 2], [1, 3])
            .is_err());
    }

    #[test]
    fn only_the_direct_charge_may_reduce_a_protected_receipt() {
        let original = rates(2, 2, 3);
        let adjusted = rates(3, 3, 4);
        // Original 10 * 2/3 can round up to 7. With a direct charge of two,
        // 8 * 3/4 pays at least 6. With no allowance, 7.5 can round to 7.
        assert!(original
            .protects_row(&adjusted, [10 * SCALE, 0], [8 * SCALE, 0], [true, true])
            .is_ok());
        assert!(original
            .protects_row(&adjusted, [10 * SCALE, 0], [10 * SCALE, 0], [true, true])
            .is_ok());
        // Keeping exactly the same fractional rate and face is rationally
        // safe, but a different circulation could take one rounded atom.
        assert!(original
            .protects_row(&original, [10 * SCALE, 0], [10 * SCALE, 0], [false, true])
            .is_err());
        assert!(original
            .protects_row(&original, [10 * SCALE, 0], [10 * SCALE, 0], [true, false])
            .is_ok());
    }
}

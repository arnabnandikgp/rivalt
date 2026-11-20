//! Bound the charge to profitable accounts whose gains back the other market.
//! These bounds compare plans only when both original recovery ceilings are met.
use super::original_terms::OriginalTerms;
use financial_core::{
    clearing::{
        row::Row,
        scalable::{collection::ReducedCollection, snapshot::ClaimTotal},
    },
    Error, Result, SCALE,
};
use num_bigint::BigUint;
use num_integer::Integer;
use num_traits::{One, ToPrimitive, Zero};

/// Market totals in scaled collateral atoms. Only collections on two-debt
/// rows can be fractional. Rounding those UP relaxes both foreign protections.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct ProtectionTotals {
    pub own_cash_upper: [ClaimTotal; 2],
    pub linked_face: [ClaimTotal; 2],
    pub incoming_debt: [ClaimTotal; 2],
    pub budget: [u128; 2],
}

fn number(words: [u64; 3]) -> BigUint {
    BigUint::new(
        words
            .iter()
            .flat_map(|&word| [word as u32, (word >> 32) as u32])
            .collect(),
    )
}

fn add(total: &mut ClaimTotal, scaled: u128) -> Result<()> {
    *total = total.add(ClaimTotal::from_words([
        scaled as u64,
        (scaled >> 64) as u64,
        0,
    ])?)?;
    Ok(())
}

impl ProtectionTotals {
    /// Both claims and budgets must come from the same authenticated frozen row.
    pub fn include(&mut self, row: &Row, budget: [u64; 2]) -> Result<[bool; 2]> {
        let own = ReducedCollection::for_row(row)?;
        let mut next = *self;
        let mut linked = [false; 2];
        for market in 0..2 {
            let other = 1 - market;
            let cash = number(own.numerators[market])
                .div_ceil(&BigUint::from(own.denominator))
                .to_u128()
                .ok_or(Error::Overflow)?;
            let debt = row.claims[market].min(0).unsigned_abs();
            // Whole debtor budgets leave assigned own cash intact, even when
            // the latter has a fractional scaled unit.
            let remaining = debt.checked_sub(cash).ok_or(Error::Entitlement)?;
            let charged = u128::from(budget[market]) * SCALE as u128;
            if charged > remaining {
                return Err(Error::Entitlement);
            }
            add(&mut next.own_cash_upper[market], cash)?;
            next.budget[market] = next.budget[market]
                .checked_add(u128::from(budget[market]))
                .ok_or(Error::Overflow)?;
            if row.claims[other] > 0 && remaining > 0 {
                // A positive foreign claim implies at most one debt. All the
                // collected cash for this link is therefore integral.
                if own.denominator != 1 {
                    return Err(Error::Invariant);
                }
                linked[other] = true;
                add(&mut next.linked_face[other], row.claims[other] as u128)?;
                add(&mut next.incoming_debt[market], remaining - charged)?;
            }
        }
        *self = next;
        Ok(linked)
    }

    pub fn linked_caps(
        &self,
        positive: [ClaimTotal; 2],
        pools: [u64; 2],
        insurance: [u64; 2],
        terms: &OriginalTerms,
    ) -> Result<[u128; 2]> {
        let unit = BigUint::from(SCALE as u128);
        let positive = positive.map(|value| number(value.words()));
        let cash: [BigUint; 2] = core::array::from_fn(|m| {
            &unit * (u128::from(pools[m]) + u128::from(insurance[m]))
                + number(self.own_cash_upper[m].words())
        });
        let mut caps = self.budget;
        for (market, cap) in caps.iter_mut().enumerate() {
            let other = 1 - market;
            let (num, den) = terms.payment(other);
            let gross = &positive[other] * num;
            let outside = &cash[other] * den;
            let charged = &unit * self.budget[market];
            if charged > positive[market] {
                return Err(Error::Entitlement);
            }
            if gross <= outside {
                continue;
            }
            let face = &positive[market] - charged;
            let available = &cash[market] + number(self.incoming_debt[market].words());
            let (upper_num, upper_den) = if face <= available {
                (BigUint::one(), BigUint::one())
            } else {
                (available, face)
            };
            if upper_num.is_zero() {
                return Err(Error::Entitlement);
            }
            let divisor = den * upper_num;
            let maximum = number(self.linked_face[market].words()) * &divisor;
            let required = (gross - outside) * upper_den;
            if required > maximum {
                return Err(Error::Entitlement);
            }
            let linked = (maximum - required) / (divisor * &unit);
            if linked < BigUint::from(*cap) {
                *cap = linked.to_u128().ok_or(Error::Overflow)?;
            }
        }
        Ok(caps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(cash: u64, claims: [i128; 2]) -> Row {
        Row {
            cash,
            claims: claims.map(|value| value * SCALE),
        }
    }
    fn terms(rates: [u64; 2]) -> OriginalTerms {
        OriginalTerms::from_market_totals(
            rates.map(BigUint::from),
            100u64.into(),
            [BigUint::zero(), BigUint::zero()],
            [BigUint::zero(), BigUint::zero()],
        )
        .unwrap()
    }

    #[test]
    fn caps_charges_to_a_foreign_creditor_and_rejects_infeasible_collateral() {
        let mut scan = ProtectionTotals::default();
        assert_eq!(
            scan.include(&row(0, [60, -20]), [0, 5]).unwrap(),
            [true, false]
        );
        assert_eq!(
            scan.include(&row(0, [-40, 80]), [10, 0]).unwrap(),
            [false, true]
        );
        let face = ClaimTotal::from_words([(100 * SCALE) as u64, 0, 0]).unwrap();
        // After full recovery BTC pays at most 50/90. ETH needs at least
        // 59 - 30 = 29 from BTC. The BTC-linked positions must retain 52.2
        // of their 60 positive atoms, allowing at most seven whole charges.
        assert_eq!(
            scan.linked_caps([face; 2], [18, 30], [2, 0], &terms([40, 59]))
                .unwrap(),
            [7, 5]
        );
        assert_eq!(
            scan.linked_caps([face; 2], [18, 30], [2, 0], &terms([40, 70])),
            Err(Error::Entitlement)
        );
        assert_eq!(
            scan.linked_caps([face; 2], [100, 100], [0, 0], &terms([100, 100]))
                .unwrap(),
            [10, 5]
        );
    }

    #[test]
    fn rounds_fractional_cash_outwards_and_preserves_progress_on_rejection() {
        let mut scan = ProtectionTotals::default();
        assert_eq!(
            scan.include(&row(1, [-2, -1]), [1, 0]).unwrap(),
            [false, false]
        );
        assert_eq!(
            scan.own_cash_upper.map(ClaimTotal::words),
            [[666_666_667, 0, 0], [333_333_334, 0, 0]]
        );
        let before = scan;
        assert!(scan.include(&row(4, [10, -7]), [0, 4]).is_err());
        assert_eq!(scan, before);
        assert_eq!(
            scan.include(&row(7, [10, -7]), [0, 0]).unwrap(),
            [false, false]
        );
    }
}

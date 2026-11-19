//! A lower rational with the same whole-atom capacities at every admissible lot count.
use super::{
    BigUint, Error, FrozenCapacity, Integer, Result, ToPrimitive, Zero, MAX_LOTS, MAX_PRICE,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LotRate {
    pub numerator: u64,
    pub denominator: u64,
}

impl LotRate {
    pub fn validate(self) -> Result<Self> {
        if self.denominator == 0
            || self.denominator > MAX_LOTS as u64
            || u128::from(self.numerator) > u128::from(MAX_PRICE) * u128::from(self.denominator)
        {
            return Err(Error::Bounds);
        }
        Ok(self)
    }

    pub fn capacity(self, lots: u64) -> Result<u64> {
        self.validate()?;
        if lots > MAX_LOTS as u64 {
            return Err(Error::Bounds);
        }
        u64::try_from(u128::from(lots) * u128::from(self.numerator) / u128::from(self.denominator))
            .map_err(|_| Error::Overflow)
    }

    pub fn matched(self, charge: u64) -> Result<u64> {
        self.validate()?;
        if charge == 0 {
            return Ok(0);
        }
        if self.numerator == 0 {
            return Err(Error::Bounds);
        }
        u64::try_from(
            (u128::from(charge) * u128::from(self.denominator))
                .div_ceil(u128::from(self.numerator)),
        )
        .map_err(|_| Error::Overflow)
    }
}

impl FrozenCapacity {
    /// For Q original lots, every point where floor(k*r) changes has a
    /// denominator at most Q (1 <= k <= Q). The greatest fraction <= r
    /// with denominator <= Q therefore preserves every eligible whole charge.
    pub fn lot_rate(&self, original_lots: u64) -> Result<LotRate> {
        if original_lots == 0 || original_lots > MAX_LOTS as u64 {
            return Err(Error::Bounds);
        }
        if self.per_lot.is_zero() {
            return Ok(LotRate {
                numerator: 0,
                denominator: 1,
            });
        }
        let mut numerator = self.per_lot.clone();
        let mut denominator = self.unit.clone();
        let (mut prior_num, mut prior_den) = (0u64, 1u64);
        let (mut best_num, mut best_den) = (1u64, 0u64);
        loop {
            let (quotient, remainder) = numerator.div_rem(&denominator);
            if best_den > 0 {
                let available = (original_lots - prior_den) / best_den;
                if quotient > BigUint::from(available) {
                    let middle = LotRate {
                        numerator: prior_num + available * best_num,
                        denominator: prior_den + available * best_den,
                    };
                    let best = LotRate {
                        numerator: best_num,
                        denominator: best_den,
                    };
                    // These are adjacent Farey bounds. Exactly one is below
                    // the source. Their order alternates at each convergent.
                    return if u128::from(middle.numerator) * u128::from(best.denominator)
                        < u128::from(best.numerator) * u128::from(middle.denominator)
                    {
                        middle
                    } else {
                        best
                    }
                    .validate();
                }
            }
            let next = quotient.to_u64().ok_or(Error::Overflow)?;
            let (next_num, next_den) = (prior_num + next * best_num, prior_den + next * best_den);
            if remainder.is_zero() {
                return LotRate {
                    numerator: next_num,
                    denominator: next_den,
                }
                .validate();
            }
            (prior_num, prior_den) = (best_num, best_den);
            (best_num, best_den) = (next_num, next_den);
            numerator = denominator;
            denominator = remainder;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use num_traits::One;
    #[test]
    fn bounded_rate_agrees_at_every_lot_and_charge_with_a_direct_exact_fraction() {
        for den in 1..=43u64 {
            for num in 0..=2 * den {
                let wide = FrozenCapacity {
                    eligible: 1000,
                    unit: den.into(),
                    per_lot: num.into(),
                };
                for limit in [1, 2, 3, 7, 16, 31, 64] {
                    let rate = wide.lot_rate(limit).unwrap();
                    assert!(
                        rate.denominator <= limit && rate.numerator * den <= num * rate.denominator
                    );
                    for lots in 1..=limit {
                        let cap = lots * num / den;
                        assert_eq!(rate.capacity(lots), Ok(cap));
                        if cap > 0 {
                            assert_eq!(rate.matched(cap), Ok(wide.schedule(cap).unwrap().matched));
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn very_long_surviving_basis_preserves_each_side_of_a_tick() {
        let denominator = BigUint::one() << 1024usize;
        let tick = &denominator * 5u64;
        for (per_lot, expected) in [
            (
                &tick - 1u64,
                LotRate {
                    numerator: 499_999_999,
                    denominator: 100_000_000,
                },
            ),
            (
                &tick + 1u64,
                LotRate {
                    numerator: 5,
                    denominator: 1,
                },
            ),
        ] {
            let wide = FrozenCapacity {
                eligible: 500_000_000,
                unit: denominator.clone(),
                per_lot,
            };
            assert_eq!(wide.lot_rate(100_000_000), Ok(expected));
        }
    }
}

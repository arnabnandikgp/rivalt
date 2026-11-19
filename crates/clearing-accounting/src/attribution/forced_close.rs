use super::*;

// Whole lots, with a concession of base_ticks on every matched lot and one
// extra tick on the first extra_tick_lots. Zero charge has an empty schedule.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PairedLots {
    pub eligible: u64,
    pub charge: u64,
    pub matched: u64,
    pub base_ticks: u64,
    pub extra_tick_lots: u64,
}

/// Fixed frozen inputs for all charge proposals on this position.
#[derive(Clone, Debug)]
pub struct FrozenCapacity {
    pub eligible: u64,
    unit: BigUint,
    per_lot: BigUint,
}

impl FrozenCapacity {
    pub fn schedule(&self, charge: u64) -> Result<PairedLots> {
        if charge > self.eligible {
            return Err(Error::Bounds);
        }
        let mut plan = PairedLots {
            eligible: self.eligible,
            charge,
            ..Default::default()
        };
        if charge > 0 {
            plan.matched = (&self.unit * charge)
                .div_ceil(&self.per_lot)
                .to_u64()
                .ok_or(Error::Overflow)?;
            plan.base_ticks = charge / plan.matched;
            plan.extra_tick_lots = charge % plan.matched;
        }
        Ok(plan)
    }
}

impl Attribution {
    /// The price of each lot stays between mark and entry and inside the price
    /// domain. A partial reduction may charge only the matched share of unpaid
    /// gain. The two constraints need different rounding.
    pub fn paired_lots(
        &self,
        lots: i64,
        mark: u64,
        claim: i128,
        available_lots: u64,
        shortfall: u64,
    ) -> Result<PairedLots> {
        let terms = self.frozen_capacity(lots, mark, claim, available_lots)?;
        terms.schedule(shortfall.min(terms.eligible))
    }

    pub fn frozen_capacity(
        &self,
        lots: i64,
        mark: u64,
        claim: i128,
        available_lots: u64,
    ) -> Result<FrozenCapacity> {
        let empty = || FrozenCapacity {
            eligible: 0,
            per_lot: BigUint::zero(),
            unit: BigUint::one(),
        };
        let quantity = lots.unsigned_abs();
        if mark == 0
            || mark > MAX_PRICE
            || quantity > MAX_LOTS as u64
            || available_lots > quantity
            || self.entry.is_zero() != (lots == 0)
        {
            return Err(Error::Bounds);
        }
        if claim <= 0 || available_lots == 0 {
            return Ok(empty());
        }
        let unit = &self.denominator * SCALE as u64;
        let gain = self.price_profit(lots.signum(), mark);
        if gain.sign() != Sign::Plus || gain.magnitude() <= &self.paid {
            return Ok(empty());
        }
        let gain = gain.magnitude();
        let room = if lots > 0 { mark - 1 } else { MAX_PRICE - mark };
        let ticks = (gain / &unit).min(room.into());
        let per_lot = (ticks * &unit).min(gain - &self.paid);
        if per_lot.is_zero() {
            return Ok(empty());
        }
        let eligible = ((&per_lot * available_lots) / &unit)
            .min(BigUint::from((claim / SCALE) as u128))
            .to_u64()
            .ok_or(Error::Overflow)?;
        Ok(FrozenCapacity {
            eligible,
            per_lot,
            unit,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn minimal_lots_respect_integer_prices_and_proportionally_released_unpaid_gain() {
        // Three longs bought at 94, with 13 of the 18 marked gain already paid.
        // The remaining capacity is 5/3 per lot. Four atoms need three lots:
        // two execute at 99 and one at 98. Two atoms need two lots.
        let long = Attribution::default()
            .fill(0, 3, 282)
            .unwrap()
            .payment(3, 100, 18 * SCALE, 13)
            .unwrap();
        for (shortfall, charge, matched, base_ticks, extra_tick_lots) in [
            (8, 5, 3, 1, 2),
            (4, 4, 3, 1, 1),
            (2, 2, 2, 1, 0),
            (1, 1, 1, 1, 0),
            (0, 0, 0, 0, 0),
        ] {
            assert_eq!(
                long.paired_lots(3, 100, 5 * SCALE, 3, shortfall).unwrap(),
                PairedLots {
                    eligible: 5,
                    charge,
                    matched,
                    base_ticks,
                    extra_tick_lots
                }
            );
        }
        // Fractional entry of 105.5 on four short lots. The per-lot price can
        // concede at most five ticks, even though gross aggregate gain is 22.
        let short = Attribution::default().fill(0, -4, 422).unwrap();
        assert_eq!(
            short.paired_lots(-4, 100, 22 * SCALE, 4, 17).unwrap(),
            PairedLots {
                eligible: 20,
                charge: 17,
                matched: 4,
                base_ticks: 4,
                extra_tick_lots: 1
            }
        );
        assert_eq!(
            short.paired_lots(-4, 100, 0, 4, 17).unwrap(),
            PairedLots::default()
        );
    }
}

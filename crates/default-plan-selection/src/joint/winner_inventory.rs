//! Available opposing debtor lots for computing original winner weights.
//! A score scan can resolve a member from side totals unless the minimum
//! payable lot quantity falls inside the observed range of debtor sizes.
use clearing_accounting::attribution::LotRate;
use financial_core::{Error, Result, SCALE};

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct SideInventory {
    pub total: u64,
    pub smallest: u64,
    pub largest: u64,
    pub fastest: u64,
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct MarketInventory {
    pub sides: [SideInventory; 2],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpposingLots {
    Known(u64),
    Scan { minimum: u64 },
}

impl MarketInventory {
    pub fn include(&mut self, lots: i64, claim: i128, rate: LotRate, budget: u64) -> Result<()> {
        rate.validate()?;
        if lots == 0 {
            return Ok(());
        }
        let quantity = lots.unsigned_abs();
        let side = &mut self.sides[usize::from(lots > 0)];
        if budget > 0 {
            side.total = side.total.checked_add(quantity).ok_or(Error::Overflow)?;
            side.smallest = if side.smallest == 0 {
                quantity
            } else {
                side.smallest.min(quantity)
            };
            side.largest = side.largest.max(quantity);
        }
        if claim >= SCALE && rate.capacity(quantity)? > 0 {
            side.fastest = side.fastest.max(rate.numerator.div_ceil(rate.denominator));
        }
        Ok(())
    }

    pub fn opposing(&self, lots: i64, claim: i128, rate: LotRate) -> Result<OpposingLots> {
        if lots == 0 || claim < SCALE || rate.capacity(lots.unsigned_abs())? == 0 {
            return Ok(OpposingLots::Known(0));
        }
        let side = self.sides[usize::from(lots < 0)];
        let minimum = rate.matched(1)?;
        if side.total == 0 || side.largest < minimum {
            return Ok(OpposingLots::Known(0));
        }
        if side.smallest >= minimum {
            return Ok(OpposingLots::Known(side.total.min(lots.unsigned_abs())));
        }
        Ok(OpposingLots::Scan { minimum })
    }

    pub fn debtor_floor(&self, lots: i64, budget: u64) -> Result<u64> {
        if budget == 0 {
            return Ok(0);
        }
        let fastest = self.sides[usize::from(lots < 0)].fastest;
        if lots == 0 || fastest == 0 {
            return Err(Error::Entitlement);
        }
        Ok(budget.div_ceil(fastest))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_debtor_sizes_require_only_the_eligible_rows() {
        let rate = LotRate {
            numerator: 1,
            denominator: 3,
        };
        let mut inventory = MarketInventory::default();
        for (lots, budget) in [(1, 1), (3, 1), (4, 1), (20, 0)] {
            inventory
                .include(
                    lots,
                    -10 * SCALE,
                    LotRate {
                        numerator: 0,
                        denominator: 1,
                    },
                    budget,
                )
                .unwrap();
        }
        assert_eq!(
            inventory.opposing(-10, 4 * SCALE, rate).unwrap(),
            OpposingLots::Scan { minimum: 3 }
        );
        assert_eq!(
            inventory.opposing(-2, 4 * SCALE, rate).unwrap(),
            OpposingLots::Known(0)
        );
        assert_eq!(
            inventory
                .opposing(
                    -10,
                    4 * SCALE,
                    LotRate {
                        numerator: 1,
                        denominator: 1
                    }
                )
                .unwrap(),
            OpposingLots::Known(8)
        );
    }
}

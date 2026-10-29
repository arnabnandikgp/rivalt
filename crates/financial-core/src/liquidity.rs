//! Exact three-instance funding allocation over available published quantities.
//! Zero means unavailable at that quantity, not an empty prefix of feasibility.
//! No source, capital identity, risk admission or consumption is invented here.
use crate::{Error, Participant, Result, IM_BPS, MAX_CASH, MAX_LOTS, MAX_PRICE, MAX_SCALED, SCALE};

/// Validated isolated, funded maker risk inputs for an exhaustive quantity
/// search. This projects admission only; selected legs still execute the full
/// account transition. Bounds below make the smaller arithmetic widths exact.
pub struct PreparedMakerRisk {
    position: Participant,
    lower_scaled: i128,
    upper_scaled: i128,
    upper: u64,
    cash_scaled: i128,
}

pub struct MakerRiskQuote {
    pub lots: i64,
    pub generation: u64,
    equity: i128,
    initial: u64,
}

impl PreparedMakerRisk {
    pub fn new(position: Participant, lower: u64, upper: u64, funding: i128) -> Result<Self> {
        if lower == 0 || lower > upper || upper > MAX_PRICE {
            return Err(Error::Bounds);
        }
        let position = position.accrued(funding)?;
        Ok(Self {
            position,
            lower_scaled: i128::from(lower) * SCALE,
            upper_scaled: i128::from(upper) * SCALE,
            upper,
            cash_scaled: i128::from(position.cash) * SCALE,
        })
    }

    /// Independent hypothetical fill from the same original position. No
    /// monotonic health assumption, mutation, fee or positive-claim credit.
    #[inline(always)]
    pub fn quote(&self, taker_side: u8, quantity: u64, gross: u64) -> Result<MakerRiskQuote> {
        if taker_side > 1
            || quantity == 0
            || quantity > MAX_LOTS as u64
            || gross == 0
            || gross > MAX_CASH
        {
            return Err(Error::Bounds);
        }
        let delta = if taker_side == 0 {
            -(quantity as i64)
        } else {
            quantity as i64
        };
        let lots = self
            .position
            .lots
            .checked_add(delta)
            .ok_or(Error::Overflow)?;
        if lots.unsigned_abs() > MAX_LOTS as u64 {
            return Err(Error::Bounds);
        }
        let generation =
            crate::next_generation(self.position.lots, lots, self.position.generation)?;
        if lots != 0 && generation == u64::MAX {
            return Err(Error::Bounds);
        }
        let quote_scaled = i128::from(gross) * SCALE;
        let virtual_scaled = if taker_side == 0 {
            self.position.virtual_scaled.checked_add(quote_scaled)
        } else {
            self.position.virtual_scaled.checked_sub(quote_scaled)
        }
        .ok_or(Error::Overflow)?;
        if virtual_scaled.unsigned_abs() > MAX_SCALED as u128 {
            return Err(Error::Bounds);
        }
        let price = if lots < 0 {
            self.upper_scaled
        } else {
            self.lower_scaled
        };
        let claim = virtual_scaled
            .checked_add(i128::from(lots).checked_mul(price).ok_or(Error::Overflow)?)
            .ok_or(Error::Overflow)?;
        // MAX_LOTS * MAX_PRICE * IM_BPS <= 1e17, within u64. Keep
        // checked products and the same per-position ceil as Participant::margin.
        let initial = lots
            .unsigned_abs()
            .checked_mul(self.upper)
            .and_then(|notional| notional.checked_mul(IM_BPS))
            .ok_or(Error::Overflow)?
            .div_ceil(10_000);
        Ok(MakerRiskQuote {
            lots,
            generation,
            equity: self
                .cash_scaled
                .checked_add(claim.min(0))
                .ok_or(Error::Overflow)?,
            initial,
        })
    }
}

impl MakerRiskQuote {
    #[inline(always)]
    pub fn admits(&self, reserved: u64) -> bool {
        crate::cash_add(self.initial, reserved)
            .is_ok_and(|required| self.equity >= i128::from(required) * SCALE)
    }
}

pub const SAMPLE_MAKERS: usize = 3;
pub const MAX_SAMPLE_LOTS: usize = 600;
pub const SAMPLE_STRIDE: usize = MAX_SAMPLE_LOTS + 1;
pub const SAMPLE_ENTRIES: usize = SAMPLE_MAKERS * SAMPLE_STRIDE;
pub const SAMPLE_SCRATCH_BYTES: usize = SAMPLE_ENTRIES * core::mem::size_of::<u64>();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SampleAllocation {
    pub gross: u64,
    pub quantities: [u64; SAMPLE_MAKERS],
}

/// The caller authenticates all three candidates and fills this one-side table
/// with exact prices at available, in-band published quantities (D74). The same
/// allocation buffer can be cleared/reused for the other side (14,424 bytes).
/// Funding has no taker fee, no synthetic trader and no depth mutation.
pub fn best_sample_pair(
    table: &[u64],
    quantity: u64,
    side: u8,
) -> Result<Option<SampleAllocation>> {
    if table.len() != SAMPLE_ENTRIES
        || !(1..=MAX_SAMPLE_LOTS as u64).contains(&quantity)
        || side > 1
    {
        return Err(Error::Bounds);
    }
    for maker in 0..SAMPLE_MAKERS {
        if table[maker * SAMPLE_STRIDE] != 0 {
            return Err(Error::Invariant);
        }
        for lots in 1..=quantity as usize {
            let gross = table[maker * SAMPLE_STRIDE + lots];
            if gross != 0 && (gross < lots as u64 || gross > lots as u64 * MAX_PRICE) {
                return Err(Error::Bounds);
            }
        }
    }
    let mut best: Option<SampleAllocation> = None;
    // Visit in the complete tie order: singletons first in ID order, then
    // lexicographic pairs, then descending first-leg quantity. Equal prices
    // retain the first visited candidate; no repeated tie-vector scans needed.
    let mut consider = |candidate: SampleAllocation| {
        if best.as_ref().is_none_or(|previous| {
            if side == 0 {
                candidate.gross < previous.gross
            } else {
                candidate.gross > previous.gross
            }
        }) {
            best = Some(candidate);
        }
    };
    for maker in 0..SAMPLE_MAKERS {
        let gross = table[maker * SAMPLE_STRIDE + quantity as usize];
        if gross != 0 {
            let mut quantities = [0; SAMPLE_MAKERS];
            quantities[maker] = quantity;
            consider(SampleAllocation { gross, quantities });
        }
    }
    for first in 0..SAMPLE_MAKERS {
        for second in first + 1..SAMPLE_MAKERS {
            for first_lots in (1..quantity).rev() {
                let second_lots = quantity - first_lots;
                let first_gross = table[first * SAMPLE_STRIDE + first_lots as usize];
                let second_gross = table[second * SAMPLE_STRIDE + second_lots as usize];
                if first_gross == 0 || second_gross == 0 {
                    continue;
                }
                let gross = first_gross
                    .checked_add(second_gross)
                    .ok_or(Error::Overflow)?;
                let mut quantities = [0; SAMPLE_MAKERS];
                quantities[first] = first_lots;
                quantities[second] = second_lots;
                consider(SampleAllocation { gross, quantities });
            }
        }
    }
    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepared_risk_keeps_literal_nonprefix_fraction_and_ceiling_cases() {
        let position = Participant {
            cash: 500,
            lots: 3,
            virtual_scaled: -30_000 * SCALE,
            generation: 1,
            ..Participant::default()
        };
        let risk = PreparedMakerRisk::new(position, 9900, 10100, SCALE).unwrap();
        assert_eq!(
            (1..=4)
                .map(|lots| risk.quote(0, lots, lots * 10010).unwrap().admits(0))
                .collect::<Vec<_>>(),
            [false, false, true, false]
        );
        let close = risk.quote(0, 3, 30030).unwrap();
        assert_eq!(
            (close.lots, close.generation, close.equity, close.initial),
            (0, 2, 500 * SCALE, 0)
        );
        assert!(!close.admits(501));
        for debt in [0, 1] {
            let fractional = Participant {
                cash: 0,
                virtual_scaled: -30030 * SCALE - debt,
                ..position
            };
            assert_eq!(
                PreparedMakerRisk::new(fractional, 9900, 10100, 0)
                    .unwrap()
                    .quote(0, 3, 30030)
                    .unwrap()
                    .admits(0),
                debt == 0
            );
        }
        for cash in [2001, 2002] {
            let rounded = PreparedMakerRisk::new(
                Participant {
                    cash,
                    ..Participant::default()
                },
                9900,
                10001,
                0,
            )
            .unwrap()
            .quote(0, 1, 9000)
            .unwrap();
            assert_eq!(rounded.initial, 1001);
            assert_eq!(rounded.admits(0), cash == 2002);
        }
    }

    #[test]
    fn prepared_risk_preserves_full_transition_bounds_and_generation_exhaustion() {
        let mut comparisons = 0;
        for inventory in [-MAX_LOTS, -1, 0, 1, MAX_LOTS] {
            for virtual_scaled in [-MAX_SCALED, -1, 0, 1, MAX_SCALED] {
                for generation in [0, u64::MAX - 1, u64::MAX] {
                    let original = Participant {
                        cash: MAX_CASH,
                        lots: inventory,
                        virtual_scaled,
                        generation,
                        ..Participant::default()
                    };
                    let prepared = PreparedMakerRisk::new(original, 1, MAX_PRICE, 0);
                    assert_eq!(prepared.is_ok(), original.accrued(0).is_ok());
                    let Ok(prepared) = prepared else {
                        continue;
                    };
                    for side in 0..=1 {
                        for quantity in [1, 2, 600, MAX_LOTS as u64, MAX_LOTS as u64 + 1] {
                            for gross in [1, MAX_CASH, MAX_CASH + 1] {
                                let projected = prepared.quote(side, quantity, gross);
                                let actual = original.quoted_fill(1 - side, quantity, gross, 0);
                                assert_eq!(projected.is_ok(), actual.is_ok());
                                if let (Ok(projected), Ok(mut actual)) = (projected, actual) {
                                    assert_eq!(
                                        (projected.lots, projected.generation),
                                        (actual.lots, actual.generation)
                                    );
                                    for reserved in [0, 1, MAX_CASH] {
                                        actual.reserved = reserved;
                                        assert_eq!(
                                            projected.admits(reserved),
                                            actual.admissible(1, MAX_PRICE, 0).is_ok()
                                        );
                                    }
                                }
                                comparisons += 1;
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(comparisons, 1650);
    }

    #[test]
    fn complete_width_literal_optimum_and_fixed_scratch_budget() {
        assert_eq!(SAMPLE_SCRATCH_BYTES, 14_424);
        assert!(SAMPLE_SCRATCH_BYTES <= 16 * 1024);
        let mut table = vec![0; SAMPLE_ENTRIES];
        for side in 0..=1 {
            for lots in 1..=600u64 {
                let spread = [10 * lots + lots * (lots - 1), 30 * lots, 20 * lots];
                for maker in 0..3 {
                    table[maker * SAMPLE_STRIDE + lots as usize] = if side == 0 {
                        10_000 * lots + spread[maker]
                    } else {
                        10_000 * lots - spread[maker]
                    };
                }
            }
            let best = best_sample_pair(&table, 600, side).unwrap().unwrap();
            assert_eq!(best.quantities, [6, 0, 594]);
            assert_eq!(best.gross, if side == 0 { 6_011_970 } else { 5_988_030 });
        }
    }

    #[test]
    fn nonprefix_health_is_preserved_and_three_capitals_are_never_combined() {
        let mut table = vec![0; SAMPLE_ENTRIES];
        table[3] = 300;
        table[SAMPLE_STRIDE + 1] = 100;
        table[2 * SAMPLE_STRIDE + 1] = 100;
        assert_eq!(
            best_sample_pair(&table, 4, 0).unwrap().unwrap().quantities,
            [3, 1, 0]
        );
        assert!(best_sample_pair(&table, 5, 0).unwrap().is_none());
        table[3] = 0;
        table[1] = 100;
        assert!(best_sample_pair(&table, 3, 0).unwrap().is_none());
    }

    #[test]
    fn exact_ties_prefer_single_then_instance_ids_then_first_quantity() {
        let mut table = vec![0; SAMPLE_ENTRIES];
        for maker in 0..3 {
            for lots in 1..=4 {
                table[maker * SAMPLE_STRIDE + lots] = lots as u64 * 100;
            }
        }
        assert_eq!(
            best_sample_pair(&table, 4, 0).unwrap().unwrap().quantities,
            [4, 0, 0]
        );
        for maker in 0..3 {
            table[maker * SAMPLE_STRIDE + 4] = 0;
        }
        assert_eq!(
            best_sample_pair(&table, 4, 0).unwrap().unwrap().quantities,
            [3, 1, 0]
        );
        table[SAMPLE_STRIDE + 1] = 0;
        assert_eq!(
            best_sample_pair(&table, 4, 0).unwrap().unwrap().quantities,
            [2, 2, 0]
        );
    }

    #[test]
    fn malformed_table_quantity_side_and_price_bounds_fail_closed() {
        let mut table = vec![0; SAMPLE_ENTRIES];
        assert!(best_sample_pair(&table, 0, 0).is_err());
        assert!(best_sample_pair(&table, 601, 0).is_err());
        assert!(best_sample_pair(&table, 1, 2).is_err());
        assert!(best_sample_pair(&table[..SAMPLE_ENTRIES - 1], 1, 0).is_err());
        table[0] = 1;
        assert!(best_sample_pair(&table, 1, 0).is_err());
        table[0] = 0;
        table[1] = MAX_PRICE + 1;
        assert!(best_sample_pair(&table, 1, 0).is_err());
        table[1] = 0;
        table[2] = 1;
        assert!(best_sample_pair(&table, 2, 0).is_err());
    }
}

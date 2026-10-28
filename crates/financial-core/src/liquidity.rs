//! Exact three-instance funding allocation over independently admitted quantities.
//! Zero means unavailable at that quantity, not an empty prefix of feasibility.
//! No source, capital identity, risk admission or consumption is invented here.
use crate::{Error, Result, MAX_PRICE};

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

impl SampleAllocation {
    fn better_than(&self, previous: &Self, side: u8) -> bool {
        if self.gross != previous.gross {
            return if side == 0 {
                self.gross < previous.gross
            } else {
                self.gross > previous.gross
            };
        }
        let count = |values: &[u64; SAMPLE_MAKERS]| {
            values.iter().filter(|quantity| **quantity != 0).count()
        };
        let current_count = count(&self.quantities);
        let previous_count = count(&previous.quantities);
        if current_count != previous_count {
            return current_count < previous_count;
        }
        // At most two legs: first/last selected IDs are the full sorted identity vector.
        let ends = |values: &[u64; SAMPLE_MAKERS]| {
            (
                values.iter().position(|quantity| *quantity != 0).unwrap(),
                values.iter().rposition(|quantity| *quantity != 0).unwrap(),
            )
        };
        let current_ids = ends(&self.quantities);
        let previous_ids = ends(&previous.quantities);
        if current_ids != previous_ids {
            return current_ids < previous_ids;
        }
        self.quantities[current_ids.0] > previous.quantities[previous_ids.0]
    }
}

/// The caller authenticates all three candidates and fills this one-side table
/// with exact prices only where full maker post-fill admission succeeds. The same
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
    let mut consider = |candidate: SampleAllocation| {
        if best
            .as_ref()
            .is_none_or(|previous| candidate.better_than(previous, side))
        {
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

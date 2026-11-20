//! Durable, verified priorities for a one-page diagnostic. Equal-total plans
//! with incomparable financial profiles require a separate reflection proof.
use super::*;
use core::cmp::Ordering;
use default_plan_selection::{
    joint::{Charge, Receipt},
    joint_priority::{compare_order, sharing, PairOrder, Profile, Ratio, RecoveryScore},
    member_priority,
};
use num_traits::ToPrimitive;

impl StoredRatio {
    fn pack(value: Ratio) -> Result<Self> {
        let Ratio(numerator, denominator) = value.reduced();
        Ok(Self {
            numerator: numerator.to_i128().ok_or(ProofError::Unsupported)?,
            denominator: denominator.to_u128().ok_or(ProofError::Unsupported)?,
        })
    }
    fn value(self) -> Ratio {
        Ratio(self.numerator.into(), self.denominator.into())
    }
}
fn ordinal(rows: &[SearchMember], member: u64) -> Result<usize> {
    rows.binary_search_by_key(&member, |row| row.id)
        .map_err(|_| ProofError::Source.into())
}
impl Priorities {
    pub fn verified(
        search: &RecoverySearch,
        receipt: &Receipt,
        charges: &[Charge],
    ) -> Result<Self> {
        let recovered = RecoveryScore::new(receipt.recovered.clone(), &receipt.original_losses);
        let zero = StoredRatio {
            numerator: 0,
            denominator: 1,
        };
        let mut fractions = [zero; 2];
        for (target, score) in fractions.iter_mut().zip(recovered.fractions) {
            *target = StoredRatio::pack(score)?;
        }
        let mut totals = vec![[0u64; 2]; search.rows.len()];
        let mut cost = [(0u128, 0u128); 2];
        require!(charges.len() == receipt.fills.len(), ProofError::Accounting);
        for (charge, fill) in charges.iter().zip(&receipt.fills) {
            let charged = &mut totals[ordinal(&search.rows, charge.winner)?][charge.market];
            *charged = charged
                .checked_add(charge.atoms)
                .ok_or(ProofError::Accounting)?;
            cost[charge.market].0 += u128::from(charge.atoms);
            cost[charge.market].1 += u128::from(fill.matched);
        }
        let profile =
            sharing(&totals, &search.weights, cost).map_err(|_| ProofError::Accounting)?;
        let [btc, eth] = profile.deviation;
        Ok(Self {
            fractions,
            deviation: [StoredRatio::pack(btc)?, StoredRatio::pack(eth)?],
            costs: cost.map(|(atoms, lots)| [atoms, lots]),
        })
    }
    fn profile(&self) -> Profile {
        Profile {
            deviation: self.deviation.map(StoredRatio::value),
            cost: self.costs.map(|[atoms, lots]| (atoms, lots)),
        }
    }
    pub fn financial_order(&self, other: &Self) -> Option<Ordering> {
        for (left, right) in self.fractions.iter().zip(&other.fractions) {
            let order = left.value().compare(&right.value());
            if !order.is_eq() {
                return Some(order);
            }
        }
        let left = self.profile();
        let right = other.profile();
        if left == right {
            Some(Ordering::Equal)
        } else if left.dominates(&right) {
            Some(Ordering::Greater)
        } else if right.dominates(&left) {
            Some(Ordering::Less)
        } else {
            None
        }
    }
}

pub fn episode_order(
    search: &RecoverySearch,
    venue: &Address,
    incumbent: &[Charge],
    challenger: &[Charge],
) -> Result<Ordering> {
    let mut order: Vec<_> = search
        .rows
        .iter()
        .enumerate()
        .map(|(ordinal, row)| {
            (
                member_priority(venue.as_ref(), search.epoch, row.id),
                row.id,
                ordinal,
            )
        })
        .collect();
    order.sort_unstable();
    let mut ranks = vec![0usize; search.rows.len()];
    for (rank, (_, _, ordinal)) in order.into_iter().enumerate() {
        ranks[ordinal] = rank;
    }
    let ordered = |charges: &[Charge]| -> Result<(_, _)> {
        let mut totals = vec![[0u64; 2]; search.rows.len()];
        let mut pairs = PairOrder::new();
        for charge in charges {
            let winner = ranks[ordinal(&search.rows, charge.winner)?];
            let debtor = ranks[ordinal(&search.rows, charge.debtor)?];
            totals[winner][charge.market] = totals[winner][charge.market]
                .checked_add(charge.atoms)
                .ok_or(ProofError::Accounting)?;
            pairs.insert((winner, charge.market, debtor), charge.atoms);
        }
        Ok((totals, pairs))
    };
    let (left, left_pairs) = ordered(incumbent)?;
    let (right, right_pairs) = ordered(challenger)?;
    Ok(compare_order(&left, &left_pairs, &right, &right_pairs))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(recovery: [i128; 2], deviations: [i128; 2], lots: [u128; 2]) -> Priorities {
        let integer = |numerator| StoredRatio {
            numerator,
            denominator: 1,
        };
        Priorities {
            fractions: recovery.map(integer),
            deviation: deviations.map(integer),
            costs: lots.map(|value| [10, value]),
        }
    }

    #[test]
    fn market_balance_precedes_sharing_and_sharing_precedes_lots() {
        let balanced = profile([5, 5], [2, 2], [3, 3]);
        assert_eq!(
            balanced.financial_order(&profile([4, 6], [0, 0], [1, 1])),
            Some(Ordering::Greater)
        );
        assert_eq!(
            balanced.financial_order(&profile([5, 5], [2, 3], [1, 1])),
            Some(Ordering::Greater)
        );
        assert_eq!(
            balanced.financial_order(&profile([5, 5], [2, 2], [3, 4])),
            Some(Ordering::Greater)
        );
    }
    #[test]
    fn market_tradeoffs_never_reach_the_identity_tie_break() {
        let original = profile([5, 5], [2, 2], [3, 3]);
        assert_eq!(
            original.financial_order(&profile([5, 5], [1, 3], [1, 1])),
            None
        );
        assert_eq!(
            original.financial_order(&profile([5, 5], [2, 2], [2, 4])),
            None
        );
        assert_eq!(original.financial_order(&original), Some(Ordering::Equal));
    }
    #[test]
    fn fractional_priorities_reduce_exactly_or_decline_the_book() {
        let wide = num_bigint::BigUint::from(1u8) << 150u32;
        let cap =
            StoredRatio::pack(Ratio(num_bigint::BigInt::from(&wide * 3u8), &wide * 4u8)).unwrap();
        assert_eq!((cap.numerator, cap.denominator), (3, 4));
        assert!(StoredRatio::pack(Ratio(1.into(), wide)).is_err());
    }
}

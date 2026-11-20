//! Durable, verified priorities for a one-page diagnostic. Equal-total plans
//! with incomparable financial profiles require a separate reflection proof.
use super::{
    search::{RecoverySearch, SearchMember},
    *,
};
use core::cmp::Ordering;
use default_plan_selection::{
    joint::{Charge, Receipt},
    joint_priority::{compare_order, sharing, PairOrder, Profile, Ratio, RecoveryScore},
    member_priority,
};
use num_traits::ToPrimitive;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Default, Clone, Copy)]
pub struct StoredRatio {
    numerator: i128,
    denominator: u128,
}
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
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Default, Clone, Copy)]
pub struct Priorities {
    fractions: [StoredRatio; 2],
    deviation: [StoredRatio; 2],
    costs: [[u128; 2]; 2],
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
        let mut totals = [[0u64; 2]; 8];
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
    let mut ranks = [0usize; 8];
    for (rank, (_, _, ordinal)) in order.into_iter().enumerate() {
        ranks[ordinal] = rank;
    }
    let ordered = |charges: &[Charge]| -> Result<(_, _)> {
        let mut totals = [[0u64; 2]; 8];
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

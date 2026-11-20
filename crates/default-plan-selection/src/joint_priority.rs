//! Financial priority rules shared by native selection and restartable on-chain verification.
extern crate alloc;
use crate::joint::{Edge, FrozenBook};
use alloc::{vec, vec::Vec};
use core::cmp::Ordering;
use financial_core::Result;
use num_bigint::{BigInt, BigUint};
use num_integer::Integer;
use num_traits::Zero;

#[derive(Clone, Debug)]
pub struct Ratio(pub BigInt, pub BigUint);
impl Ratio {
    pub fn compare(&self, other: &Self) -> Ordering {
        (&self.0 * BigInt::from(other.1.clone())).cmp(&(&other.0 * BigInt::from(self.1.clone())))
    }
    pub fn sum(&self, other: &Self) -> Self {
        Self(
            &self.0 * BigInt::from(other.1.clone()) + &other.0 * BigInt::from(self.1.clone()),
            &self.1 * &other.1,
        )
    }
}
impl PartialEq for Ratio {
    fn eq(&self, other: &Self) -> bool {
        self.compare(other).is_eq()
    }
}
impl Eq for Ratio {}
impl Ratio {
    pub fn reduced(self) -> Self {
        let divisor = self.0.magnitude().gcd(&self.1);
        Self(self.0 / BigInt::from(divisor.clone()), self.1 / divisor)
    }
}

pub struct RecoveryScore {
    pub total: Ratio,
    pub fractions: Vec<Ratio>,
}
impl RecoveryScore {
    pub fn new(recovered: [(BigInt, BigUint); 2], losses: &[BigUint; 2]) -> Self {
        let values = recovered.map(|(n, d)| Ratio(n, d));
        // Both original loss numerators use the same settlement denominator. It
        // cancels when sorting and comparing the market recovery fractions.
        let mut fractions: Vec<_> = values
            .iter()
            .zip(losses)
            .filter(|(_, loss)| !loss.is_zero())
            .map(|(value, loss)| Ratio(value.0.clone(), &value.1 * loss))
            .collect();
        fractions.sort_by(Ratio::compare);
        Self {
            total: values[0].sum(&values[1]),
            fractions,
        }
    }
    pub fn compare(&self, other: &Self) -> Ordering {
        self.total.compare(&other.total).then_with(|| {
            self.fractions
                .iter()
                .zip(&other.fractions)
                .map(|(left, right)| left.compare(right))
                .find(|value| !value.is_eq())
                .unwrap_or(Ordering::Equal)
        })
    }
}

#[derive(PartialEq, Eq)]
pub struct Profile {
    pub deviation: [Ratio; 2],
    pub cost: [(u128, u128); 2],
}
impl Profile {
    pub fn dominates(&self, other: &Self) -> bool {
        if self.deviation != other.deviation {
            return (0..2).all(|market| {
                !self.deviation[market]
                    .compare(&other.deviation[market])
                    .is_gt()
            });
        }
        self.cost != other.cost && (0..2).all(|market| self.cost[market] <= other.cost[market])
    }
}
/// Weighted squared deviation from the proportional allocation, followed by
/// (atoms charged, matched lots) per market. All totals come from verified fills.
pub fn sharing(
    totals: &[[u64; 2]],
    weights: &[[u64; 2]],
    cost: [(u128, u128); 2],
) -> Result<Profile> {
    if totals.len() != weights.len() {
        return Err(financial_core::Error::Cohort);
    }
    let deviation = core::array::from_fn(|market| {
        let mut sum = Ratio(0.into(), 1u8.into());
        let mut weight = 0u128;
        for (member, cap) in weights.iter().enumerate().filter(|(_, w)| w[market] > 0) {
            let charged = BigInt::from(totals[member][market]);
            weight += u128::from(cap[market]);
            sum = sum
                .sum(&Ratio(&charged * &charged, cap[market].into()))
                .reduced();
        }
        if weight == 0 {
            return sum;
        }
        let total = BigInt::from(cost[market].0);
        sum.sum(&Ratio(-(&total * &total), weight.into())).reduced()
    });
    Ok(Profile { deviation, cost })
}

pub fn weights(book: &FrozenBook<'_>, edges: &[Edge]) -> Result<Vec<[u64; 2]>> {
    let mut pairable = vec![[0u64; 2]; book.members.len()];
    for edge in edges {
        let lots = &mut pairable[edge.winner][edge.market];
        *lots = lots
            .saturating_add(book.members[edge.debtor].lots[edge.market].unsigned_abs())
            .min(book.members[edge.winner].lots[edge.market].unsigned_abs());
    }
    book.members
        .iter()
        .zip(pairable)
        .map(|(member, lots)| {
            Ok([
                book.capacity(member, 0, lots[0])?.eligible,
                book.capacity(member, 1, lots[1])?.eligible,
            ])
        })
        .collect()
}

/// Last financial tie: compare charged winners first, then individual pairs,
/// using ordinals in frozen-episode priority order in both representations.
pub type PairOrder = alloc::collections::BTreeMap<(usize, usize, usize), u64>;
pub fn compare_order(
    members: &[[u64; 2]],
    pairs: &PairOrder,
    other_members: &[[u64; 2]],
    other_pairs: &PairOrder,
) -> Ordering {
    members.cmp(other_members).then_with(|| {
        // Compare the sparse pair charge vectors at the earliest differing key.
        pairs
            .keys()
            .chain(other_pairs.keys())
            .filter_map(|key| {
                let order = pairs
                    .get(key)
                    .unwrap_or(&0)
                    .cmp(other_pairs.get(key).unwrap_or(&0));
                (!order.is_eq()).then_some((key, order))
            })
            .min_by_key(|&(key, _)| key)
            .map_or(Ordering::Equal, |(_, order)| order)
    })
}

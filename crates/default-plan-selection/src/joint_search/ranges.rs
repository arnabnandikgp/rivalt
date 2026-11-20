//! Prove complete coverage of the same charge space with deterministic interval
//! splits. An interval can be discarded only when *all* its charges combined
//! cannot match the verified incumbent's total recovery.
use super::alloc::vec::Vec;
use super::{Charge, FrozenBook, FrozenPriority, RecoveryScore, Witness};
use core::cmp::Ordering;
use financial_core::{Error, Result};
use num_bigint::{BigInt, BigUint};
use num_traits::{One, Zero};

#[derive(Default, Debug)]
pub struct RangeCost {
    pub nodes: u64,
    pub leaves: u64,
    pub verified: u64,
    pub pruned: BigUint,
}
pub struct RangeCoverage {
    pub combinations: BigUint,
    pub cost: RangeCost,
    /// None while the work limit is reached. No partial comparison selects cash.
    pub finalists: Option<Vec<Vec<Charge>>>,
    pub selected: Option<Vec<Charge>>,
}
#[derive(Clone, Copy)]
struct Interval {
    low: u64,
    high: u64,
}
fn size(ranges: &[Interval]) -> BigUint {
    ranges.iter().fold(BigUint::one(), |product, r| {
        product * (BigUint::from(r.high - r.low) + 1u8)
    })
}
struct Node {
    bounds: Vec<Interval>,
}
impl Node {
    fn split(&self) -> Option<(Node, Node)> {
        let (index, range) = self
            .bounds
            .iter()
            .enumerate()
            .filter(|(_, r)| r.high > r.low)
            .max_by_key(|(index, r)| (r.high - r.low, core::cmp::Reverse(*index)))?;
        let middle = range.low + (range.high - range.low) / 2;
        let mut lower = self.bounds.clone();
        lower[index].high = middle;
        let mut upper = self.bounds.clone();
        upper[index].low = middle + 1;
        Some((Node { bounds: lower }, Node { bounds: upper }))
    }
}
impl FrozenBook<'_> {
    /// The untrusted starting plan supplies only a lower bound. Its exact rate
    /// and rounding witnesses are verified before its score can exclude a range.
    pub fn cover_ranges<'w>(
        &self,
        original: Witness<'_>,
        hint: &[Charge],
        work: u64,
        priority: FrozenPriority<'_>,
        mut witness: impl FnMut(&[Charge]) -> Option<Witness<'w>>,
    ) -> Result<RangeCoverage> {
        let baseline = self.verify_proposal(original, original, &[])?;
        let proposal = if hint.is_empty() {
            None
        } else {
            let mut canonical = hint.to_vec();
            canonical.sort_unstable();
            Some(self.verify_proposal(
                original,
                witness(&canonical).ok_or(Error::Cohort)?,
                &canonical,
            )?)
        };
        let floor = proposal.as_ref().unwrap_or(&baseline);
        let mut best = RecoveryScore::new(floor.recovered.clone(), &baseline.original_losses);
        let mut edges = Vec::new();
        self.visit_edges(&baseline.budgets, |edge| {
            edges.push(edge);
            Ok(true)
        })?;
        let initial = Node {
            bounds: edges
                .iter()
                .map(|edge| Interval {
                    low: 0,
                    high: edge.maximum,
                })
                .collect(),
        };
        let combinations = size(&initial.bounds);
        let weights = crate::joint_priority::weights(self, &edges)?;
        let mut queue = super::alloc::vec![initial];
        let mut cost = RangeCost::default();
        let mut finalists = Vec::new();
        // At most one unvisited sibling per level. Search the larger charges
        // first; order can improve the floor but never determines a winner.
        while let Some(node) = queue.pop() {
            if cost.nodes == work {
                return Ok(RangeCoverage {
                    combinations,
                    cost,
                    finalists: None,
                    selected: None,
                });
            }
            cost.nodes += 1;
            // If the minimum charges already consume too many lots, positive
            // face or debtor cash, no larger charge vector in the box can execute.
            let lower: Vec<_> = node.bounds.iter().map(|range| range.low).collect();
            let Some(charges) = self.candidate(&edges, &lower, &baseline.budgets)? else {
                cost.pruned += size(&node.bounds);
                continue;
            };
            let mut debtor_max = super::alloc::vec![[0u128;2];self.members.len()];
            let mut winner_max = debtor_max.clone();
            for (edge, range) in edges.iter().zip(&node.bounds) {
                for total in [
                    &mut debtor_max[edge.debtor][edge.market],
                    &mut winner_max[edge.winner][edge.market],
                ] {
                    *total = total
                        .checked_add(u128::from(range.high))
                        .ok_or(Error::Overflow)?;
                }
            }
            let capped = |potential: &[[u128; 2]], limits: &[[u64; 2]], market: usize| {
                potential
                    .iter()
                    .zip(limits)
                    .fold(BigUint::zero(), |sum, (row, cap)| {
                        sum + row[market].min(u128::from(cap[market]))
                    })
            };
            let upper: BigUint = (0..2)
                .map(|market| {
                    capped(&debtor_max, &baseline.budgets, market).min(capped(
                        &winner_max,
                        &weights,
                        market,
                    ))
                })
                .sum();
            if BigInt::from(upper) * BigInt::from(best.total.1.clone()) < best.total.0 {
                cost.pruned += size(&node.bounds);
                continue;
            }
            if let Some((low, high)) = node.split() {
                queue.push(low);
                queue.push(high);
                continue;
            }
            cost.leaves += 1;
            let verified;
            let receipt = if charges.is_empty() {
                &baseline
            } else {
                let rates = witness(&charges).ok_or(Error::Cohort)?;
                verified = match self.verify_proposal(original, rates, &charges) {
                    Ok(receipt) => receipt,
                    Err(Error::Entitlement) => continue,
                    Err(error) => return Err(error),
                };
                &verified
            };
            cost.verified += 1;
            let score = RecoveryScore::new(receipt.recovered.clone(), &baseline.original_losses);
            match score.compare(&best) {
                Ordering::Greater => {
                    best = score;
                    finalists.clear();
                    finalists.push(charges);
                }
                Ordering::Equal => finalists.push(charges),
                Ordering::Less => {}
            }
        }
        if &cost.pruned + cost.leaves != combinations || finalists.is_empty() {
            return Err(Error::Invariant);
        }
        let selected = self.selected(
            original,
            &baseline,
            &edges,
            &finalists,
            priority,
            &mut witness,
        )?;
        Ok(RangeCoverage {
            combinations,
            cost,
            finalists: Some(finalists),
            selected,
        })
    }
}

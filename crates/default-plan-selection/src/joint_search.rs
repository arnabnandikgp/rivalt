//! Exhaustive native comparison on a caller-budgeted frozen book. The candidate
//! space is derived from financial rows, budgets, lot directions and paid history.
//! A caller supplies rate/rounding witnesses, never the list of competitors.
use crate::joint::{Charge, Edge, FrozenBook, Witness};
mod priorities;
mod ranges;
use alloc::vec::Vec;
use core::cmp::Ordering;
use financial_core::{Error, Result, SCALE};
use num_bigint::{BigInt, BigUint};
use num_integer::Integer;
use num_traits::{One, Zero};
pub use priorities::FrozenPriority;
pub use ranges::{RangeCost, RangeCoverage};
extern crate alloc;

#[derive(Clone, Debug)]
struct Ratio(BigInt, BigUint);
impl Ratio {
    fn compare(&self, other: &Self) -> Ordering {
        (&self.0 * BigInt::from(other.1.clone())).cmp(&(&other.0 * BigInt::from(self.1.clone())))
    }
    fn sum(&self, other: &Self) -> Self {
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
    fn reduced(self) -> Self {
        let divisor = self.0.magnitude().gcd(&self.1);
        Self(self.0 / BigInt::from(divisor.clone()), self.1 / divisor)
    }
}

struct RecoveryScore {
    total: Ratio,
    fractions: Vec<Ratio>,
}
impl RecoveryScore {
    fn new(recovered: [(BigInt, BigUint); 2], losses: &[BigUint; 2]) -> Self {
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
    fn compare(&self, other: &Self) -> Ordering {
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

/// Report every schedule tied on D120 recovery. Selection additionally applies
/// the proportional, closure and identity rules. An absent selection requires
/// a valid market reflection or represents a still-incomparable trade-off.
pub enum Coverage {
    OverBudget {
        at_least: BigUint,
    },
    Complete {
        combinations: u64,
        structurally_valid: u64,
        admitted: u64,
        finalists: Vec<Vec<Charge>>,
        selected: Option<Vec<Charge>>,
    },
}

impl FrozenBook<'_> {
    pub fn recovery_frontier<'w>(
        &self,
        original: Witness<'_>,
        limit: u64,
        priority: FrozenPriority<'_>,
        mut witness: impl FnMut(&[Charge]) -> Option<Witness<'w>>,
    ) -> Result<Coverage> {
        let baseline = self.verify_proposal(original, original, &[])?;
        let mut edges = Vec::new();
        let mut combinations = BigUint::one();
        if limit == 0 {
            return Ok(Coverage::OverBudget {
                at_least: combinations,
            });
        }
        let complete = self.visit_edges(&baseline.budgets, |edge| {
            combinations *= BigUint::from(edge.maximum) + 1u8;
            if combinations > BigUint::from(limit) {
                return Ok(false);
            }
            edges.push(edge);
            Ok(true)
        })?;
        if !complete {
            return Ok(Coverage::OverBudget {
                at_least: combinations,
            });
        }
        let mut digits = alloc::vec![0u64;edges.len()];
        let mut best = None::<RecoveryScore>;
        let mut finalists = Vec::new();
        let mut valid = 0;
        let mut admitted = 0;
        let count = u64::try_from(combinations).map_err(|_| Error::Overflow)?;
        for rank in 0..count {
            let mut remainder = rank;
            for (digit, edge) in digits.iter_mut().zip(&edges).rev() {
                let choices = edge.maximum.checked_add(1).ok_or(Error::Overflow)?;
                *digit = remainder % choices;
                remainder /= choices;
            }
            let Some(charges) = self.candidate(&edges, &digits, &baseline.budgets)? else {
                continue;
            };
            valid += 1;
            let computed;
            let receipt = if charges.is_empty() {
                &baseline
            } else {
                let effective = witness(&charges).ok_or(Error::Cohort)?;
                computed = match self.verify_proposal(original, effective, &charges) {
                    Ok(receipt) => receipt,
                    Err(Error::Entitlement) => continue,
                    Err(error) => return Err(error),
                };
                &computed
            };
            admitted += 1;
            let score = RecoveryScore::new(receipt.recovered.clone(), &baseline.original_losses);
            let ordering = best
                .as_ref()
                .map_or(Ordering::Greater, |previous| score.compare(previous));
            if ordering.is_gt() {
                best = Some(score);
                finalists.clear();
            }
            if !ordering.is_lt() {
                finalists.push(charges);
            }
        }
        let selected = self.selected(
            original,
            &baseline,
            &edges,
            &finalists,
            priority,
            &mut witness,
        )?;
        Ok(Coverage::Complete {
            selected,
            combinations: count,
            structurally_valid: valid,
            admitted,
            finalists,
        })
    }

    fn selected<'w>(
        &self,
        original: Witness<'_>,
        baseline: &crate::joint::Receipt,
        edges: &[Edge],
        finalists: &[Vec<Charge>],
        priority: FrozenPriority<'_>,
        witness: &mut impl FnMut(&[Charge]) -> Option<Witness<'w>>,
    ) -> Result<Option<Vec<Charge>>> {
        Ok(if finalists.len() == 1 {
            Some(finalists[0].clone())
        } else {
            priorities::select(self, baseline, edges, finalists, priority, |charges| {
                if charges.is_empty() {
                    return self.verify_proposal(original, original, charges);
                }
                let target = witness(charges).ok_or(Error::Cohort)?;
                self.verify_proposal(original, target, charges)
            })?
        })
    }

    fn candidate(
        &self,
        edges: &[Edge],
        digits: &[u64],
        budgets: &[[u64; 2]],
    ) -> Result<Option<Vec<Charge>>> {
        let mut remaining = budgets.to_vec();
        let mut inventory: Vec<_> = self
            .members
            .iter()
            .map(|m| m.lots.map(i64::unsigned_abs))
            .collect();
        let mut faces: Vec<_> = self
            .members
            .iter()
            .map(|m| m.row.claims.map(|claim| claim.max(0) / SCALE))
            .collect();
        let mut charges = Vec::new();
        for (edge, &atoms) in edges.iter().zip(digits) {
            if atoms == 0 {
                continue;
            }
            let &Edge {
                market,
                debtor,
                winner,
                ..
            } = edge;
            let available = inventory[winner][market].min(inventory[debtor][market]);
            if atoms > remaining[debtor][market] || i128::from(atoms) > faces[winner][market] {
                return Ok(None);
            }
            let lots = edge.capacity.schedule(atoms)?.matched;
            if lots > available {
                return Ok(None);
            }
            inventory[winner][market] -= lots;
            inventory[debtor][market] -= lots;
            faces[winner][market] -= i128::from(atoms);
            remaining[debtor][market] -= atoms;
            charges.push(Charge {
                market,
                debtor: self.members[debtor].id,
                winner: self.members[winner].id,
                atoms,
            });
        }
        Ok(Some(charges))
    }
}

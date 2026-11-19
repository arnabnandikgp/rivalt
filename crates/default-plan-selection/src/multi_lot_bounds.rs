//! Sufficient optimality bounds over the same feasible set as the exact search.
use super::*;

impl Book {
    /// A false result means the bounds leave a challenger possible. Only a
    /// feasible proposal attaining every bound has a certificate.
    pub fn verifies_by_bounds(&self, charges: &[u64]) -> Result<bool> {
        let Some(score) = self.score(charges)? else {
            return Ok(false);
        };
        let all_budgets = self
            .debtors
            .iter()
            .map(|debtor| u128::from(debtor.budget))
            .sum::<u128>();
        let all_gains = self
            .winners
            .iter()
            .map(|winner| u128::from(winner.terms.eligible))
            .sum::<u128>();
        if score.recovered != all_budgets.min(all_gains) {
            return Ok(false);
        }

        // A strict gap proves that these are the unique aggregate winner
        // charges minimizing sum(q²/c) among *all* allocations of this total.
        let mut last_selected = None;
        let mut first_remaining = None;
        let mut lot_floor = 0u128;
        let mut targets = Vec::new();
        for (winner, &charge) in self.winners.iter().zip(&score.charges) {
            if charge > 0 {
                let cost = &winner.weight * (2 * u128::from(charge) - 1);
                if last_selected.as_ref().is_none_or(|old| &cost > old) {
                    last_selected = Some(cost);
                }
                lot_floor += u128::from(winner.terms.schedule(charge)?.matched);
                targets.push(charge);
            }
            if charge < winner.terms.eligible {
                let cost = &winner.weight * (2 * u128::from(charge) + 1);
                if first_remaining.as_ref().is_none_or(|old| &cost < old) {
                    first_remaining = Some(cost);
                }
            }
        }
        if matches!((last_selected, first_remaining),(Some(last),Some(first)) if last >= first) {
            return Ok(false);
        }

        // Each participating debtor must close at least one lot. Even if
        // the largest budgets can all be spent first, their prefix must fund T.
        let mut budgets: Vec<_> = self.debtors.iter().map(|debtor| debtor.budget).collect();
        budgets.sort_unstable_by(|left, right| right.cmp(left));
        let mut remaining = score.recovered;
        let mut needed = 0usize;
        for &budget in &budgets {
            if remaining == 0 {
                break;
            }
            remaining = remaining.saturating_sub(u128::from(budget));
            needed += 1;
        }
        lot_floor = lot_floor.max(needed as u128);
        // If all budgets are spent and N debtors and N winners close just N
        // lots, every debtor has exactly one winner and vice versa. The two
        // multisets of charges must then be identical.
        if score.recovered == all_budgets
            && budgets.len() == targets.len()
            && lot_floor == targets.len() as u128
        {
            targets.sort_unstable_by(|left, right| right.cmp(left));
            if targets != budgets {
                lot_floor += 1;
            }
        }
        if score.closed != lot_floor {
            return Ok(false);
        }

        // With the winner totals fixed, no competitor can exceed this upper
        // bound at the first differing D121 edge if its preceding edges match.
        let mut available: Vec<_> = self.debtors.iter().map(|debtor| debtor.budget).collect();
        let mut wanted = score.charges;
        for (edge, &charge) in self.edges.iter().zip(charges) {
            if charge
                != edge
                    .maximum
                    .min(available[edge.debtor])
                    .min(wanted[edge.winner])
            {
                return Ok(false);
            }
            available[edge.debtor] -= charge;
            wanted[edge.winner] -= charge;
        }
        Ok(true)
    }
}

//! The native search and clearing use the same compact, sufficient proof.
use super::*;
use crate::compact_book;

impl Book {
    pub fn verifies_by_bounds(&self, charges: &[u64]) -> Result<bool> {
        if self.score(charges)?.is_none() {
            return Ok(false);
        }
        let mut debtors: Vec<_> = self
            .debtors
            .iter()
            .map(|member| compact_book::Debtor {
                id: member.id,
                lots: member.lots,
                budget: member.budget,
            })
            .collect();
        let mut winners = self
            .winners
            .iter()
            .map(|member| {
                Ok(compact_book::Winner {
                    id: member.id,
                    lots: member.lots,
                    face: member.terms.eligible,
                    rate: member.terms.lot_rate(member.lots.unsigned_abs())?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        debtors.sort_unstable_by_key(|row| row.id);
        winners.sort_unstable_by_key(|row| row.id);
        let plan = match compact_book::select(&self.venue, self.epoch, &debtors, &winners) {
            Ok(Some(plan)) => plan,
            Ok(None) | Err(Error::Overflow) => return Ok(false),
            Err(error) => return Err(error),
        };
        Ok(self
            .pair_order()
            .zip(charges)
            .filter(|(_, charge)| **charge > 0)
            .map(|((debtor, winner), &charge)| (debtor, winner, charge))
            .eq(plan
                .pairs
                .iter()
                .map(|pair| (pair.debtor, pair.winner, pair.charge))))
    }
}

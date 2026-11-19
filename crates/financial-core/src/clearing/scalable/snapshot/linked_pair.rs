//! Complete-cohort certificate for one cross debtor and one unlinked winner
//! per market. Whole funded shares make every creditor floor exact.
use super::*;
use core::num::NonZeroU128;

impl SnapshotScan {
    pub fn linked_cash_shares(&self, debtor: Row, lots: [i64; 2]) -> Result<[u64; 2]> {
        let totals = self.result()?;
        let debts = debtor.debts();
        for market in 0..2 {
            if debts[market] == 0
                || debts[market] % SCALE as u128 != 0
                || lots[market] == 0
                || lots[market].unsigned_abs().checked_mul(2) != Some(self.binding.gross[market])
                || totals.negative[market] != ClaimTotal::scalar(debts[market])
            {
                return Err(Error::Cohort);
            }
        }
        let face = debts.map(|debt| debt / SCALE as u128);
        let combined = NonZeroU128::new(face[0] + face[1]).ok_or(Error::Cohort)?;
        let available = u128::from(debtor.cash).min(combined.get());
        let mut shares = [0; 2];
        for (market, debt) in face.into_iter().enumerate() {
            let numerator = available.checked_mul(debt).ok_or(Error::Overflow)?;
            if numerator % combined.get() != 0 {
                return Err(Error::Cohort);
            }
            shares[market] =
                u64::try_from(numerator / combined.get()).map_err(|_| Error::Bounds)?;
        }
        Ok(shares)
    }

    /// The debtor holds its entire side of both markets. The named winner must
    /// own every positive claim and every opposing lot in this market and owe
    /// nothing in the other market. A second verified leg is required to commit.
    pub fn linked_pair_shortfall(
        &self,
        market: usize,
        debtor: Row,
        debtor_lots: [i64; 2],
        winner: Row,
        winner_lots: [i64; 2],
    ) -> Result<([u64; 2], u64)> {
        if market >= 2 {
            return Err(Error::Bounds);
        }
        let shares = self.linked_cash_shares(debtor, debtor_lots)?;
        let claim = winner.claims[market];
        if winner_lots[1 - market] != 0
            || winner.claims[1 - market] != 0
            || claim <= 0
            || debtor_lots[market].checked_neg() != Some(winner_lots[market])
            || self.result()?.positive[market] != ClaimTotal::scalar(claim as u128)
        {
            return Err(Error::Cohort);
        }
        let debt =
            u64::try_from(debtor.debts()[market] / SCALE as u128).map_err(|_| Error::Bounds)?;
        Ok((
            shares,
            debt.checked_sub(shares[market])
                .ok_or(Error::Cohort)?
                .saturating_sub(self.binding.insurance[market]),
        ))
    }
}

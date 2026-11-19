//! Complete-cohort certificate for one cross debtor and one unlinked winner
//! per market. Whole funded shares make every creditor floor exact.
use super::*;
use core::num::NonZeroU128;

impl SnapshotScan {
    /// Keep one authenticated whole BTC claim belonging to a fully flat account.
    /// Taking the maximum makes the witness independent of membership order.
    /// Release requires it to explain the *entire* positive remainder.
    pub fn accept_linked_row(
        &mut self,
        ordinal: u64,
        id: u64,
        row: &Row,
        lots: [i64; 2],
    ) -> Result<()> {
        self.accept(ordinal, id, row, lots)?;
        let [btc, eth] = row.claims;
        if lots == [0, 0] && eth == 0 && btc > 0 && btc % SCALE == 0 {
            // Row::validate bounds the whole-atom quotient below u64::MAX.
            self.flat_btc_atoms = self.flat_btc_atoms.max((btc / SCALE) as u64);
        }
        Ok(())
    }

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
    /// own every opposing lot in this market, exhaust the positive claims
    /// together with the optional authenticated flat BTC creditor, and owe
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
        {
            return Err(Error::Cohort);
        }
        let total_positive = self.result()?.positive[market];
        let winner_claim = ClaimTotal::scalar(claim as u128);
        if total_positive != winner_claim {
            let flat = ClaimTotal::scalar(u128::from(self.flat_btc_atoms) * SCALE as u128);
            if market != 0 || claim % SCALE != 0 || total_positive != winner_claim.add(flat)? {
                return Err(Error::Cohort);
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    fn row(cash: u64, claims: [i128; 2]) -> Row {
        Row {
            cash,
            claims: claims.map(|claim| claim * SCALE),
        }
    }

    fn cohort(members: &[(Row, [i64; 2])]) -> SnapshotScan {
        let mut scan = SnapshotScan::new(SnapshotBinding {
            count: members.len() as u64,
            allocated: members.iter().map(|(member, _)| member.cash).sum::<u64>() + 4,
            pools: [0, 0],
            insurance: [3, 1],
            fees: [0, 0],
            gross: core::array::from_fn(|market| {
                members
                    .iter()
                    .map(|(_, lots)| lots[market].unsigned_abs())
                    .sum()
            }),
        })
        .unwrap();
        for (ordinal, (member, lots)) in members.iter().enumerate() {
            scan.accept_linked_row(ordinal as u64, ordinal as u64 + 2, member, *lots)
                .unwrap();
        }
        scan
    }

    #[test]
    fn whole_account_cash_and_complete_position_and_claim_ownership_are_required() {
        let debtor = row(19_992, [-10_002, -10_002]);
        let btc = row(0, [10_002, 0]);
        let eth = row(0, [0, 10_002]);
        let members = [(debtor, [1, 1]), (btc, [-1, 0]), (eth, [0, -1])];
        let snapshot = cohort(&members);
        for (market, shortfall) in [(0, 3), (1, 5)] {
            let (winner, lots) = members[market + 1];
            assert_eq!(
                snapshot.linked_pair_shortfall(market, debtor, [1, 1], winner, lots),
                Ok(([9996, 9996], shortfall))
            );
        }
        let mut fractional = members;
        fractional[0].0.cash += 1;
        assert!(cohort(&fractional)
            .linked_cash_shares(fractional[0].0, [1, 1])
            .is_err());

        let mut shared = members.to_vec();
        shared[1].0 = row(0, [10_001, 0]);
        shared.push((row(0, [1, 0]), [0, 0]));
        let witnessed = cohort(&shared);
        let bytes = witnessed.checkpoint();
        assert_eq!(bytes[0], 2);
        let mut malformed = bytes;
        malformed[0] = 1;
        assert!(SnapshotScan::from_checkpoint(&malformed, witnessed.binding).is_err());
        malformed = bytes;
        malformed[264..272].fill(0);
        assert!(SnapshotScan::from_checkpoint(&malformed, witnessed.binding).is_err());
        let restored = SnapshotScan::from_checkpoint(&bytes, witnessed.binding).unwrap();
        assert_eq!(
            restored.linked_pair_shortfall(0, debtor, [1, 1], shared[1].0, [-1, 0]),
            Ok(([9996, 9996], 3))
        );
        shared[1].0 = row(0, [10_000, 0]);
        shared.push((row(0, [1, 0]), [0, 0]));
        assert!(cohort(&shared)
            .linked_pair_shortfall(0, debtor, [1, 1], shared[1].0, [-1, 0])
            .is_err());
        shared[3].0.claims[0] += SCALE / 2;
        shared[4].0.claims[0] -= SCALE / 2;
        assert!(cohort(&shared)
            .linked_pair_shortfall(0, debtor, [1, 1], shared[1].0, [-1, 0])
            .is_err());
        shared = members.to_vec();
        shared[0].0 = row(19_992, [-10_001, -10_002]);
        shared.push((row(0, [-1, 0]), [0, 0]));
        assert!(cohort(&shared)
            .linked_cash_shares(shared[0].0, [1, 1])
            .is_err());
        let mut extra_inventory = members.to_vec();
        extra_inventory.extend([(row(0, [0, 0]), [1, 0]), (row(0, [0, 0]), [-1, 0])]);
        assert!(cohort(&extra_inventory)
            .linked_cash_shares(debtor, [1, 1])
            .is_err());
        shared = members.to_vec();
        shared[1].0 = row(0, [10_002, 1]);
        shared[2].0 = row(0, [0, 10_001]);
        assert!(cohort(&shared)
            .linked_pair_shortfall(0, debtor, [1, 1], shared[1].0, [-1, 0])
            .is_err());
    }
}

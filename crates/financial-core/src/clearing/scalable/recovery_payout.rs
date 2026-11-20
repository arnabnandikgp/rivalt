//! Conservation at the boundary between a sealed recovery proof and settlement.
//! Callers authenticate the frozen member and the corresponding verified output.
use super::snapshot::SnapshotBinding;
use crate::{Error, Result};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecoveryPayoutScan {
    count: u64,
    last_id: u64,
    cash: u128,
    movements: [i128; 2],
    claim_changes: [i128; 2],
}

impl RecoveryPayoutScan {
    /// Return the new prefix only when this exact next member reconciles.
    pub fn accept(
        mut self,
        ordinal: u64,
        member: u64,
        original_cash: u64,
        final_cash: u64,
        movements: [i64; 2],
        claim_changes: [i64; 2],
    ) -> Result<Self> {
        if ordinal != self.count || (ordinal > 0 && member <= self.last_id) {
            return Err(Error::Cohort);
        }
        if i128::from(original_cash) + i128::from(movements[0]) + i128::from(movements[1])
            != i128::from(final_cash)
        {
            return Err(Error::Invariant);
        }
        self.count = self.count.checked_add(1).ok_or(Error::Overflow)?;
        self.last_id = member;
        self.cash = self
            .cash
            .checked_add(u128::from(final_cash))
            .ok_or(Error::Overflow)?;
        for market in 0..2 {
            self.movements[market] = self.movements[market]
                .checked_add(i128::from(movements[market]))
                .ok_or(Error::Overflow)?;
            self.claim_changes[market] = self.claim_changes[market]
                .checked_add(i128::from(claim_changes[market]))
                .ok_or(Error::Overflow)?;
        }
        Ok(self)
    }

    pub fn finish(
        self,
        snapshot: SnapshotBinding,
        remaining_insurance: [u64; 2],
        retained_fees: [u64; 2],
    ) -> Result<[u64; 2]> {
        if self.count == 0
            || self.count != snapshot.count
            || self.claim_changes != [0; 2]
            || retained_fees != snapshot.fees
        {
            return Err(Error::Invariant);
        }
        let mut spent = [0; 2];
        let mut allocated = self.cash;
        for market in 0..2 {
            spent[market] = snapshot.insurance[market]
                .checked_sub(remaining_insurance[market])
                .ok_or(Error::Invariant)?;
            if self.movements[market]
                != i128::from(snapshot.pools[market]) + i128::from(spent[market])
            {
                return Err(Error::Invariant);
            }
            allocated = allocated
                .checked_add(
                    u128::from(remaining_insurance[market]) + u128::from(retained_fees[market]),
                )
                .ok_or(Error::Overflow)?;
        }
        if allocated != u128::from(snapshot.allocated) {
            return Err(Error::Invariant);
        }
        Ok(spent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn final_creditor_on_second_page_is_required_to_conserve_both_markets() {
        let snapshot = SnapshotBinding {
            count: 9,
            allocated: 26,
            pools: [1, 1],
            insurance: [4, 5],
            fees: [2, 3],
            gross: [2, 2],
        };
        // Ten atoms were in the roots and sixteen were held by the two markets.
        let mut prefix = RecoveryPayoutScan::default()
            .accept(0, 3, 10, 7, [-2, -1], [1, 0])
            .unwrap();
        for ordinal in 1..8 {
            prefix = prefix
                .accept(ordinal, ordinal * 10, 0, 0, [0, 0], [0, 0])
                .unwrap();
        }
        assert!(prefix.finish(snapshot, [2, 5], [2, 3]).is_err());
        assert!(prefix.accept(8, 70, 0, 7, [5, 2], [-1, 0]).is_err());
        assert!(prefix.accept(8, 99, 0, 6, [5, 2], [-1, 0]).is_err());
        let complete = prefix.accept(8, 99, 0, 7, [5, 2], [-1, 0]).unwrap();
        assert_eq!(complete.finish(snapshot, [2, 5], [2, 3]), Ok([2, 0]));
        // Moving one atom of insurance to ETH conserves the vault total, but
        // disagrees with the actual BTC and ETH movements.
        assert!(complete.finish(snapshot, [3, 4], [2, 3]).is_err());
        assert!(complete.finish(snapshot, [2, 5], [3, 2]).is_err());
        assert!(prefix
            .accept(8, 99, 0, 7, [5, 2], [0, -1])
            .unwrap()
            .finish(snapshot, [2, 5], [2, 3])
            .is_err());
    }
}

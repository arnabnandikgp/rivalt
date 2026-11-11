//! Reuse only completed older epochs. No caller can reset a live page, even when
//! its arithmetic value is zero. Scoped history preserves the account revision.
use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;

fn reusable(storage: &RecoveryStorage, schema: u16, venue: Address, previous: u64, epoch: u64) -> Result<()> {
    storage.model().validate().map_err(|_| ClearingError::Resolution)?;
    require!(schema == SETTLEMENT_SCHEMA && venue == storage.venue
        && storage.schema_version == SETTLEMENT_SCHEMA && epoch > 0
        && storage.locked_epoch == epoch && previous < epoch && previous <= storage.completed_epoch,
        ClearingError::Resolution);
    Ok(())
}
macro_rules! reset {
    ($name:ident, $ty:ident) => {
        #[inline(never)]
        pub(super) fn $name(account: &mut $ty, storage: &RecoveryStorage, epoch: u64) -> Result<()> {
            reusable(storage, account.schema_version, account.venue, account.epoch, epoch)?;
            require!(account.revision > 0, ClearingError::Resolution);
            *account = $ty { schema_version: account.schema_version, revision: account.revision,
                venue: account.venue, bump: account.bump, ..Default::default() };
            Ok(())
        }
    }
}
reset!(reset_prepared, PreparedSettlement);
reset!(reset_rows, FrozenMarginPage);
reset!(reset_limbs, SettlementLimbPage);
reset!(reset_rates, SettlementRates);
reset!(reset_plan, SettlementPlan);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_completed_older_work_can_be_reused_without_rewinding_the_journal() {
        let venue = Address::new_unique();
        let storage = RecoveryStorage { schema_version: SETTLEMENT_SCHEMA, venue, ready_capacity: 128,
            completed_epoch: 3, locked_epoch: 4, ..Default::default() };
        let mut page = SettlementLimbPage { schema_version: SETTLEMENT_SCHEMA, revision: 77, venue,
            epoch: 3, attempt: 9, register: 31, page_index: 2, word_count: 256, bump: 252, ..Default::default() };
        page.payload.words[255] = u64::MAX;
        reset_limbs(&mut page, &storage, 4).unwrap();
        assert_eq!((page.revision,page.bump,page.epoch,page.attempt,page.word_count),(77,252,0,0,0));
        assert!(page.payload.words.iter().all(|value| *value == 0));
        for previous in [4,5,u64::MAX] {
            page.epoch = previous;
            let mut before = Vec::new(); crate::wire::write(&page, &mut before).unwrap();
            assert!(reset_limbs(&mut page, &storage, 4).is_err());
            let mut after = Vec::new(); crate::wire::write(&page, &mut after).unwrap();
            assert_eq!(before,after);
        }
        page.epoch = 3;
        assert!(reset_limbs(&mut page, &storage, 5).is_err());
        page.schema_version = 8;
        assert!(reset_limbs(&mut page, &storage, 4).is_err());
    }
}

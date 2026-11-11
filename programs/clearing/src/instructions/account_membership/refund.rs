//! Terminal-only recovery rent reclamation. Permanent payer receipts and small
//! allocation markers prevent re-creation/replay; no trader collateral is touched.
use super::{contexts::RefundRecoveryAllocation, storage};
use crate::{events::RecoveryStorageRefunded, state::accounts::*, ClearingError};
use anchor_lang::{
    pinocchio::{
        sysvars::{rent::Rent, Sysvar},
        Resize,
    },
    prelude::*,
};
use financial_core::clearing::scalable::recovery_storage::Allocation;

fn terminal(venue: &Venue, safety: &VenueSafety, storage: &RecoveryStorage) -> Result<()> {
    storage
        .model()
        .validate()
        .map_err(|_| ClearingError::Resolution)?;
    require!(
        TRADING_IMPLEMENTED
            && venue.schema_version == SCHEMA_VERSION
            && venue.profile_version == PROFILE_VERSION
            && safety.schema_version == SCHEMA_VERSION
            && safety.mode == RETIRED
            && !safety.paused
            && storage.schema_version == SETTLEMENT_SCHEMA
            && storage.locked_epoch == 0,
        ClearingError::Resolution
    );
    Ok(())
}
pub fn refund(
    ctx: &mut Context<RefundRecoveryAllocation>,
    events: &mut crate::event_cpi::Payloads,
    kind: u8,
    register: u32,
    page: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    terminal(&accounts.venue, &accounts.safety, &accounts.storage)?;
    let expected = storage::allocation_kind(kind, register, page)?;
    let rent = Rent::get()?;
    storage::funded_allocation(
        accounts.venue.address(),
        expected,
        accounts.storage.completed_epoch,
        accounts.allocation.account(),
        accounts.receipt.account(),
        &rent,
    )?;
    let original_kind = match expected {
        Allocation::Prepared => 17,
        Allocation::FrozenRows { .. } => 18,
        Allocation::Limbs { .. } => 21,
        Allocation::Rates => 22,
        Allocation::Plan => 23,
    };
    let mut allocation = accounts.allocation.account().clone();
    let actual_revision = u64::from_le_bytes(allocation.try_borrow()?[10..18].try_into().unwrap());
    require!(actual_revision == revision, ClearingError::Resolution);
    let retained = rent.try_minimum_balance(8 + StorageTombstone::INIT_SPACE)?;
    let refunded = allocation
        .lamports()
        .checked_sub(retained)
        .ok_or(ClearingError::Arithmetic)?;
    let mut payer = accounts.rent_payer.account().clone();
    let balance = payer
        .lamports()
        .checked_add(refunded)
        .ok_or(ClearingError::Arithmetic)?;
    let tombstone = StorageTombstone {
        schema_version: SETTLEMENT_SCHEMA,
        revision,
        venue: *accounts.venue.address(),
        original_kind,
        register,
        page_index: page,
        completed_epoch: accounts.storage.completed_epoch,
        bump: storage::allocation_address(accounts.venue.address(), expected).1,
    };
    allocation.resize(8 + StorageTombstone::INIT_SPACE)?;
    crate::wire::write_account(&tombstone, &mut allocation.try_borrow_mut()?[..])?;
    allocation.set_lamports(retained);
    payer.set_lamports(balance);
    // Terminal cleanup invalidates the capacity proof immediately. Pending old
    // continuations cannot claim funded capacity over shrunken allocations.
    let mut state = accounts.storage.model();
    state.ready_capacity = 0;
    state.target_capacity = 0;
    state.next_allocation = 0;
    accounts.storage.commit(state)?;
    events.emit(
        &RecoveryStorageRefunded {
            venue: *accounts.venue.address(),
            slot: Clock::get()?.slot,
            allocation: *allocation.address(),
            rent_payer: *payer.address(),
            original_kind,
            register,
            page_index: page,
            completed_epoch: accounts.storage.completed_epoch,
            refunded_lamports: refunded,
            retained_lamports: retained,
        },
        accounts.event_authority.account().clone(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn administrative_refunds_cannot_precede_terminal_financial_completion() {
        let venue = Venue {
            schema_version: SCHEMA_VERSION,
            profile_version: PROFILE_VERSION,
            ..Default::default()
        };
        let mut safety = VenueSafety {
            schema_version: SCHEMA_VERSION,
            mode: RETIRED,
            ..Default::default()
        };
        let mut storage = RecoveryStorage {
            schema_version: SETTLEMENT_SCHEMA,
            ready_capacity: 128,
            completed_epoch: 3,
            ..Default::default()
        };
        // The same suite runs against the disabled default build. Even a fully
        // retired account must not bypass that explicit deployment gate.
        assert_eq!(terminal(&venue, &safety, &storage).is_ok(), TRADING_IMPLEMENTED);
        for mode in [CUSTODY, ACTIVE, FROZEN, RESOLVED] {
            safety.mode = mode;
            assert!(terminal(&venue, &safety, &storage).is_err());
        }
        safety.mode = RETIRED;
        storage.locked_epoch = 4;
        assert!(terminal(&venue, &safety, &storage).is_err());
        storage.locked_epoch = 0;
        safety.paused = true;
        assert!(terminal(&venue, &safety, &storage).is_err());
    }
}

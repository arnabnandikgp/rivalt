//! Additional storage in a fresh candidate margin account. Clearing owns both
//! the fixed Borsh prefix and the tail, so each financial write locks one root.
use crate::{
    state::accounts::{MarginAccount, MARGIN_ALLOCATION, MARGIN_PREFIX},
    ClearingError,
};
use anchor_lang::prelude::*;
use clearing_accounting::attribution::Attribution;

const MAGIC: &[u8; 8] = b"RVPROF01";

fn tail(
    root: &mut BorshAccount<MarginAccount>,
    operation: impl FnOnce(&mut [u8]) -> Result<()>,
) -> Result<()> {
    let mut account = root.account().clone();
    require!(
        account.data_len() == MARGIN_ALLOCATION,
        ClearingError::Profile
    );
    // RC2 holds the mutable Borsh borrow until exit. Release it while changing
    // the separately encoded tail, then retain the already deserialized prefix.
    root.release_borrow()?;
    operation(&mut account.try_borrow_mut()?[MARGIN_PREFIX..])?;
    root.reacquire_guard_only()?;
    Ok(())
}

pub fn initialize(root: &mut BorshAccount<MarginAccount>) -> Result<()> {
    tail(root, |bytes| {
        require!(bytes.iter().all(|byte| *byte == 0), ClearingError::Profile);
        bytes[..8].copy_from_slice(MAGIC);
        Ok(())
    })
}

fn market_slot(bytes: &mut [u8], market: usize) -> Result<&mut [u8]> {
    require!(
        market < 2 && bytes.starts_with(MAGIC),
        ClearingError::Profile
    );
    let width = (bytes.len() - 8) / 2;
    Ok(&mut bytes[8 + market * width..8 + (market + 1) * width])
}

pub fn fill(
    root: &mut BorshAccount<MarginAccount>,
    market: usize,
    after: i64,
    gross: u64,
) -> Result<()> {
    let before = root.positions[market].lots;
    tail(root, |bytes| {
        let slot = market_slot(bytes, market)?;
        if before.signum() == after.signum() && after.unsigned_abs() < before.unsigned_abs() {
            // Per-lot values are invariant under a same-side reduction. No
            // big integer allocation, reserialization, funding or resize here.
            return Ok(());
        }
        if after == 0 {
            slot.fill(0);
            return Ok(());
        }
        let old = Attribution::read(slot, before).map_err(|_| ClearingError::Reconciliation)?;
        let new = old
            .fill(before, after, gross)
            .map_err(|_| ClearingError::Arithmetic)?;
        require!(
            new.recovery_bytes(after)
                .is_ok_and(|needed| needed <= slot.len()),
            ClearingError::Capacity
        );
        new.write(slot).map_err(|_| ClearingError::Capacity.into())
    })
}

pub fn payment(
    root: &mut BorshAccount<MarginAccount>,
    market: usize,
    mark: u64,
    claim: i128,
    amount: u64,
) -> Result<()> {
    let lots = root.positions[market].lots;
    tail(root, |bytes| {
        let slot = market_slot(bytes, market)?;
        let old = Attribution::read(slot, lots).map_err(|_| ClearingError::Reconciliation)?;
        let new = old
            .payment(lots, mark, claim, amount)
            .map_err(|_| ClearingError::Arithmetic)?;
        new.write(slot)
            .map_err(|_| ClearingError::Reconciliation.into())
    })
}

pub fn clear_resolved(root: &mut BorshAccount<MarginAccount>) -> Result<()> {
    tail(root, |bytes| {
        require!(bytes.starts_with(MAGIC), ClearingError::Profile);
        bytes[8..].fill(0);
        Ok(())
    })
}

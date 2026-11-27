//! Additional storage in a fresh candidate margin account. Clearing owns both
//! the fixed Borsh prefix and the tail, so each financial write locks one root.
use crate::{
    state::accounts::{MarginAccount, valid_margin_size, INITIAL_ATTRIBUTION_BYTES, RENT_CREDIT_BYTES, MARGIN_PREFIX},
    ClearingError,
};
use anchor_lang::prelude::*;
use clearing_accounting::attribution::Attribution;

#[cfg(not(feature = "closed-quantity-settlement"))]
pub(crate) const MAGIC: &[u8; 8] = b"RVPROF01";
#[cfg(feature = "bounded-entry-settlement")]
use clearing_accounting::entry_cost::EntryCost;
#[cfg(feature = "bounded-entry-settlement")]
pub(crate) const MAGIC: &[u8; 8] = b"RVPROF03";
#[cfg(all(feature = "closed-quantity-settlement", not(feature = "bounded-entry-settlement")))]
pub(crate) const MAGIC: &[u8; 8] = b"RVPROF02";

fn tail(
    root: &mut BorshAccount<MarginAccount>,
    operation: impl FnOnce(&mut [u8]) -> Result<()>,
) -> Result<()> {
    let mut account = root.account().clone();
    require!(
        valid_margin_size(account.data_len()),
        ClearingError::Profile
    );
    // RC2 holds the mutable Borsh borrow until exit. Release it while changing
    // the separately encoded tail, then retain the already deserialized prefix.
    root.release_borrow()?;
    let end = attribution_end(account.data_len());
    operation(&mut account.try_borrow_mut()?[MARGIN_PREFIX..end])?;
    root.reacquire_guard_only()?;
    Ok(())
}

fn attribution_end(size: usize) -> usize {
    #[cfg(feature = "listed-margin-storage")]
    { return size.min(crate::state::accounts::MARGIN_ALLOCATION); }
    #[cfg(not(feature = "listed-margin-storage"))]
    { size }
}

pub fn initialize(root: &mut BorshAccount<MarginAccount>) -> Result<()> {
    #[cfg(feature = "listed-margin-storage")]
    {
        use crate::state::accounts::{initial_margin_size, MARGIN_ALLOCATION};
        use clearing_accounting::market_slots::storage::MAGIC as DIRECTORY_MAGIC;
        let mut account = root.account().clone();
        require!(account.data_len() == initial_margin_size(root.mode, root.isolated_market_index), ClearingError::Profile);
        if account.data_len() > MARGIN_ALLOCATION {
            root.release_borrow()?;
            {
                let mut data = account.try_borrow_mut()?;
                let directory = &mut data[MARGIN_ALLOCATION..];
                require!(directory.iter().all(|byte| *byte == 0), ClearingError::Profile);
                directory[..8].copy_from_slice(DIRECTORY_MAGIC);
            }
            root.reacquire_guard_only()?;
        }
    }
    tail(root, |bytes| {
        require!(bytes.iter().all(|byte| *byte == 0), ClearingError::Profile);
        bytes[..8].copy_from_slice(MAGIC);
        Ok(())
    })
}

fn slots_end(bytes: &[u8]) -> usize {
    if bytes.len() == 8 + 2 * INITIAL_ATTRIBUTION_BYTES { bytes.len() }
    else { bytes.len() - RENT_CREDIT_BYTES }
}

fn market_slot(bytes: &mut [u8], market: usize) -> Result<&mut [u8]> {
    require!(
        market < 2 && bytes.starts_with(MAGIC),
        ClearingError::Profile
    );
    let width = (slots_end(bytes) - 8) / 2;
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
        #[cfg(feature = "bounded-entry-settlement")]
        {
            let prior = EntryCost::read(slot, before).map_err(|_| ClearingError::Reconciliation)?;
            prior.fill(before, after, gross).and_then(|next| next.write(slot))
                .map_err(|_| ClearingError::Arithmetic.into())
        }
        #[cfg(not(feature = "bounded-entry-settlement"))]
        {
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
        #[cfg(not(feature = "closed-quantity-settlement"))]
        require!(
            new.recovery_bytes(after)
                .is_ok_and(|needed| needed <= slot.len()),
            ClearingError::Capacity
        );
        new.write(slot).map_err(|_| ClearingError::Capacity.into())
        }
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
        #[cfg(feature = "bounded-entry-settlement")]
        {
            let cap = EntryCost::read(slot, lots).and_then(|basis| basis.ordinary_cap(lots, mark, claim))
                .map_err(|_| ClearingError::Reconciliation)?;
            require!(amount <= cap, ClearingError::Amount);
            return Ok(());
        }
        #[cfg(not(feature = "bounded-entry-settlement"))]
        let old = Attribution::read(slot, lots).map_err(|_| ClearingError::Reconciliation)?;
        #[cfg(all(feature = "closed-quantity-settlement", not(feature = "bounded-entry-settlement")))]
        {
            let cap = old.closed_quantity_payment_cap(lots, mark, claim)
                .map_err(|_| ClearingError::Reconciliation)?;
            require!(amount <= cap, ClearingError::Amount);
            Ok(())
        }
        #[cfg(not(feature = "closed-quantity-settlement"))]
        {
            let new = old.payment(lots, mark, claim, amount)
                .map_err(|_| ClearingError::Arithmetic)?;
            new.write(slot).map_err(|_| ClearingError::Reconciliation.into())
        }
    })
}

pub fn clear_resolved(root: &mut BorshAccount<MarginAccount>) -> Result<()> {
    tail(root, |bytes| {
        require!(bytes.starts_with(MAGIC), ClearingError::Profile);
        let end = slots_end(bytes);
        bytes[8..end].fill(0);
        Ok(())
    })
}

#[cfg(feature="single-pair-default-qualification")]
pub(crate) fn frozen_btc_history(root:&BorshAccount<MarginAccount>) -> Result<Attribution> {
    frozen_history(root, 0)
}

#[cfg(feature="single-pair-default-qualification")]
pub fn frozen_history(root:&BorshAccount<MarginAccount>, market:usize) -> Result<Attribution> {
    require!(market < 2, ClearingError::Resolution);
    frozen_account_basis(root.account(), &root.positions, market)
}

#[cfg(feature = "single-pair-default-qualification")]
pub(crate) fn frozen_account_basis(account:&AccountView, positions:&[crate::state::records::Position;2], market:usize) -> Result<Attribution> {
    require!(market<positions.len() && valid_margin_size(account.data_len()),ClearingError::Profile);
    let data=account.try_borrow()?;
    let bytes=&data[MARGIN_PREFIX..attribution_end(data.len())];
    require!(bytes.starts_with(MAGIC),ClearingError::Profile);
    let width=(slots_end(bytes)-8)/2;
    let start=8+width*market;
    #[cfg(feature = "bounded-entry-settlement")]
    return EntryCost::read(&bytes[start..start+width], positions[market].lots)
        .and_then(|entry| entry.frozen_basis(positions[market].lots))
        .map_err(|_| ClearingError::Resolution.into());
    #[cfg(not(feature = "bounded-entry-settlement"))]
    Attribution::read(&bytes[start..start+width],positions[market].lots)
        .map_err(|_| ClearingError::Resolution.into())
}

#[cfg(all(feature="single-pair-default-qualification",not(feature="btc-residual-qualification")))]
pub fn frozen_cap(root: &BorshAccount<MarginAccount>, mark:u64, claim:i128) -> Result<u64> {
    frozen_btc_history(root)?.charge_cap(root.positions[0].lots,mark,claim,1)
        .map_err(|_|ClearingError::Resolution.into())
}

/// The exhaustive verifier copies each canonical history into a 256-byte slot
/// and trims its trailing zeroes. Measure the same program-owned bytes at freeze.
#[cfg(feature = "unified-recovery-qualification")]
pub(crate) fn exhaustive_history_bytes(root: &BorshAccount<MarginAccount>) -> Result<Option<u64>> {
    #[cfg(feature = "bounded-entry-settlement")]
    {
        let mut total = 0;
        for market in 0..2 {
            let mut buffer = [0; 40];
            frozen_history(root, market)?.write(&mut buffer).map_err(|_| ClearingError::Resolution)?;
            total += buffer.iter().rposition(|b| *b != 0).map_or(0, |n| n as u64 + 1);
        }
        Ok(Some(total))
    }
    #[cfg(not(feature = "bounded-entry-settlement"))]
    {
    let account = root.account();
    require!(valid_margin_size(account.data_len()), ClearingError::Profile);
    let data = account.try_borrow()?;
    let tail = &data[MARGIN_PREFIX..];
    require!(tail.starts_with(MAGIC), ClearingError::Profile);
    let end = slots_end(tail);
    let width = (end - MAGIC.len()) / 2;
    let mut total = 0;
    for slot in tail[MAGIC.len()..end].chunks_exact(width) {
        let length = slot.iter().rposition(|byte| *byte != 0).map_or(0, |last| last + 1);
        if length > 256 {
            return Ok(None);
        }
        total += length as u64;
    }
    Ok(Some(total))
    }
}

#[cfg(feature="btc-residual-qualification")]
pub fn btc_reduction(root:&BorshAccount<MarginAccount>, mark:u64, claim:i128, shortfall:u64)
    -> Result<clearing_accounting::attribution::PairedLots> {
    let lots=root.positions[0].lots;
    frozen_btc_history(root)?.paired_lots(lots,mark,claim,lots.unsigned_abs(),shortfall)
        .map_err(|_|ClearingError::Resolution.into())
}

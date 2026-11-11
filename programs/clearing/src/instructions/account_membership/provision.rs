use super::{contexts::*, storage};
use crate::{state::accounts::*, ClearingError};
use anchor_lang::system_program::{self, Allocate, Assign, Transfer};
use anchor_lang::{
    pinocchio::sysvars::{rent::Rent, Sysvar},
    prelude::*,
};
use financial_core::clearing::scalable::recovery_storage::Allocation;

fn available(venue: &Venue, safety: &VenueSafety) -> Result<()> {
    require!(
        TRADING_IMPLEMENTED
            && venue.schema_version == SCHEMA_VERSION
            && venue.profile_version == PROFILE_VERSION
            && safety.schema_version == SCHEMA_VERSION
            && !safety.paused
            && (safety.mode == CUSTODY || safety.mode == ACTIVE),
        ClearingError::Profile
    );
    Ok(())
}
pub fn initialize(ctx: &mut Context<InitializeRecoveryStorage>) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    available(&ctx.accounts.venue, &ctx.accounts.safety)?;
    let storage = &mut ctx.accounts.storage;
    storage.schema_version = SETTLEMENT_SCHEMA;
    storage.venue = *ctx.accounts.venue.address();
    storage.bump = ctx.bumps.storage;
    Ok(())
}
pub fn begin(
    ctx: &mut Context<ConfigureRecoveryStorage>,
    capacity: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    available(&ctx.accounts.venue, &ctx.accounts.safety)?;
    let storage = &mut ctx.accounts.storage;
    require!(storage.revision == revision, ClearingError::Resolution);
    let next = storage
        .model()
        .begin(capacity)
        .map_err(|_| ClearingError::Resolution)?;
    storage.commit(next)
}
pub fn cancel(
    ctx: &mut Context<ConfigureRecoveryStorage>,
    generation: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    available(&ctx.accounts.venue, &ctx.accounts.safety)?;
    let storage = &mut ctx.accounts.storage;
    require!(storage.revision == revision, ClearingError::Resolution);
    let next = storage
        .model()
        .cancel(generation)
        .map_err(|_| ClearingError::Resolution)?;
    storage.commit(next)
}
pub fn fund(
    ctx: &mut Context<FundRecoveryAllocation>,
    kind: u8,
    register: u32,
    page: u64,
    generation: u64,
    ordinal: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    available(&ctx.accounts.venue, &ctx.accounts.safety)?;
    let expected = ctx
        .accounts
        .storage
        .model()
        .expected(generation, ordinal)
        .map_err(|_| ClearingError::Resolution)?;
    require!(
        storage::allocation_kind(kind, register, page)? == expected,
        ClearingError::Resolution
    );
    let (key, bump) = storage::allocation_address(ctx.accounts.venue.address(), expected);
    require_keys_eq!(
        key,
        *ctx.accounts.allocation.address(),
        ClearingError::Resolution
    );
    let (discriminator, size, bump_offset) = storage::allocation_shape(expected);
    let rent = Rent::get()?;
    let allocation = &mut ctx.accounts.allocation;
    require!(
        allocation.account().owner() == &system_program::ID
            && allocation.account().data_len() == 0
            && !allocation.account().executable()
            && !allocation.account().is_signer(),
        ClearingError::Resolution
    );
    let contribution = rent
        .try_minimum_balance(size)?
        .saturating_sub(allocation.account().lamports());
    if contribution > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.address(),
                Transfer {
                    from: ctx.accounts.payer.try_to_cpi_handle_mut()?,
                    to: allocation.try_to_cpi_handle_mut()?,
                },
            ),
            contribution,
        )?;
    }
    let register_bytes = register.to_le_bytes();
    let page_bytes = page.to_le_bytes();
    let bump_bytes = [bump];
    let seeds = [
        storage::prefix(kind)?,
        ctx.accounts.venue.address().as_ref(),
        storage::register_seed(kind, &register_bytes),
        storage::page_seed(kind, &page_bytes),
        &bump_bytes,
    ];
    system_program::allocate(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.address(),
            Allocate {
                account_to_allocate: allocation.try_to_cpi_handle_mut()?,
            },
            &[&seeds],
        ),
        size as u64,
    )?;
    system_program::assign(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.address(),
            Assign {
                account_to_assign: allocation.try_to_cpi_handle_mut()?,
            },
            &[&seeds],
        ),
        &crate::ID,
    )?;
    {
        let mut view = allocation.account().clone();
        let mut bytes = view.try_borrow_mut()?;
        require!(
            bytes.len() == size && bytes.iter().all(|byte| *byte == 0),
            ClearingError::Resolution
        );
        bytes[..8].copy_from_slice(discriminator);
        bytes[8..10].copy_from_slice(&SETTLEMENT_SCHEMA.to_le_bytes());
        bytes[18..50].copy_from_slice(ctx.accounts.venue.address().as_ref());
        bytes[bump_offset] = bump;
        match expected {
            Allocation::FrozenRows { page } => bytes[58..66].copy_from_slice(&page.to_le_bytes()),
            Allocation::Limbs { register, page } => {
                bytes[66..70].copy_from_slice(&register.to_le_bytes());
                bytes[70..78].copy_from_slice(&page.to_le_bytes());
            }
            _ => {}
        }
    }
    let receipt = &mut ctx.accounts.receipt;
    receipt.schema_version = SETTLEMENT_SCHEMA;
    receipt.venue = *ctx.accounts.venue.address();
    receipt.allocation = key;
    receipt.rent_payer = *ctx.accounts.payer.address();
    receipt.contributed_lamports = contribution;
    receipt.bump = ctx.bumps.receipt;
    Ok(())
}
pub fn verify(
    ctx: &mut Context<VerifyRecoveryAllocation>,
    generation: u64,
    ordinal: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    available(&ctx.accounts.venue, &ctx.accounts.safety)?;
    let accounts = &mut ctx.accounts;
    require!(
        accounts.storage.revision == revision,
        ClearingError::Resolution
    );
    let next = storage::verify_funded_allocation(
        accounts.venue.address(),
        accounts.storage.model(),
        generation,
        ordinal,
        accounts.allocation.account(),
        accounts.receipt.account(),
        &Rent::get()?,
    )?;
    accounts.storage.commit(next)
}

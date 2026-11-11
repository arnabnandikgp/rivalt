//! Empty, rent-funded membership pages and nodes. Allocation cannot invent an
//! identity, a membership count or financial eligibility.
use super::{contexts::*, provision};
use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;
use financial_core::clearing::scalable::membership_update::{NodeAddress, NodeSummary};

pub fn page(ctx: &mut Context<FundMemberPage>, page_index: u64) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty() && page_index <= u64::MAX / 64, ClearingError::Resolution);
    provision::available(&ctx.accounts.venue, &ctx.accounts.safety)?;
    let venue = *ctx.accounts.venue.address();
    let page = page_index.to_le_bytes();
    let (key, bump) = find_program_address(&[b"member-page", venue.as_ref(), &page], &crate::ID);
    require_keys_eq!(key, *ctx.accounts.allocation.address(), ClearingError::Resolution);
    let contribution = provision::allocate(&mut ctx.accounts.payer, &mut ctx.accounts.allocation,
        ctx.accounts.system_program.address(), &[b"member-page", venue.as_ref(), &page, &[bump]], MEMBER_PAGE_BYTES)?;
    let mut account = ctx.accounts.allocation.account().clone();
    let mut bytes = account.try_borrow_mut()?;
    require!(bytes.len() == MEMBER_PAGE_BYTES && bytes.iter().all(|value| *value == 0), ClearingError::Resolution);
    bytes[..8].copy_from_slice(MemberPage::DISCRIMINATOR);
    bytes[8..10].copy_from_slice(&SCHEMA_VERSION.to_le_bytes());
    bytes[18..50].copy_from_slice(venue.as_ref());
    bytes[50..58].copy_from_slice(&page);
    bytes[MEMBER_PAGE_BYTES-1] = bump;
    set_receipt(&mut ctx.accounts.receipt, venue, key, *ctx.accounts.payer.address(), contribution, ctx.bumps.receipt);
    Ok(())
}
pub fn index(ctx: &mut Context<FundMemberIndex>, level: u8, prefix: u64) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Resolution);
    provision::available(&ctx.accounts.venue, &ctx.accounts.safety)?;
    NodeSummary::default().total(NodeAddress { level, prefix }).map_err(|_| ClearingError::Resolution)?;
    let venue = *ctx.accounts.venue.address();
    let prefix = prefix.to_le_bytes();
    let (key, bump) = find_program_address(&[b"member-index", venue.as_ref(), &[level], &prefix], &crate::ID);
    require_keys_eq!(key, *ctx.accounts.allocation.address(), ClearingError::Resolution);
    let contribution = provision::allocate(&mut ctx.accounts.payer, ctx.accounts.allocation.unchecked_mut(),
        ctx.accounts.system_program.address(), &[b"member-index", venue.as_ref(), &[level], &prefix, &[bump]], MEMBER_INDEX_BYTES)?;
    let mut account = ctx.accounts.allocation.account().clone();
    let mut bytes = account.try_borrow_mut()?;
    require!(bytes.len() == MEMBER_INDEX_BYTES && bytes.iter().all(|value| *value == 0), ClearingError::Resolution);
    bytes[..8].copy_from_slice(MemberIndexNode::DISCRIMINATOR);
    bytes[8..10].copy_from_slice(&SCHEMA_VERSION.to_le_bytes());
    bytes[18..50].copy_from_slice(venue.as_ref());
    bytes[50] = level;
    bytes[51..59].copy_from_slice(&prefix);
    bytes[MEMBER_INDEX_BYTES-1] = bump;
    set_receipt(&mut ctx.accounts.receipt, venue, key, *ctx.accounts.payer.address(), contribution, ctx.bumps.receipt);
    Ok(())
}
fn set_receipt(receipt: &mut StorageFunding, venue: Address, allocation: Address,
    payer: Address, contribution: u64, bump: u8) {
    receipt.schema_version = SCHEMA_VERSION;
    receipt.venue = venue;
    receipt.allocation = allocation;
    receipt.rent_payer = payer;
    receipt.contributed_lamports = contribution;
    receipt.bump = bump;
}

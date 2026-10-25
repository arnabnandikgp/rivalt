//! Explicit owner-only flat claim cancellation; no settlement-pool movement.
use super::*;
use crate::instructions::group_trading::{advance, book, oracle};

#[event_cpi]
#[derive(Accounts)]
pub struct NetMarginClaims<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"margin-v2", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = group, has_one = owner)]
    pub margin: Box<Account<'info, MarginAccountV2>>,
}

pub(crate) fn candidate(
    root: &MarginAccountV2,
    actor: Pubkey,
    group_key: Pubkey,
    funding: [i128; 2],
) -> Result<MarginAccountV2> {
    require_keys_eq!(actor, root.owner, ClearingError::Authority);
    require_keys_eq!(group_key, root.group, ClearingError::Profile);
    book::validate(root)?;
    require!(
        root.book.orders.iter().all(|entry| !entry.order.active()),
        ClearingError::OrderState
    );
    // Protection metadata is historical once it has no active child. It cannot
    // grant authority on its own; active children have just been rejected.
    let netted = checked(model(root)?.net_closed_claims(funding))?;
    let mut next = root.clone();
    commit_model(&mut next, netted)?;
    advance(&mut next)?;
    Ok(next)
}

pub fn net(ctx: Context<NetMarginClaims>, sequence: u64, observations: [u64; 2]) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    trading(&accounts.group, &accounts.margin)?;
    let clock = Clock::get()?;
    let environment = environment(
        &accounts.group,
        accounts.group.key(),
        &accounts.btc,
        &accounts.eth,
        sequence,
        observations,
        &clock,
    )?;
    let next = candidate(
        &accounts.margin,
        accounts.owner.key(),
        accounts.group.key(),
        environment.funding,
    )?;
    let cancelled_scaled = accounts.margin.positions[0]
        .virtual_scaled
        .checked_sub(next.positions[0].virtual_scaled)
        .ok_or(ClearingError::Arithmetic)?
        .checked_abs()
        .ok_or(ClearingError::Arithmetic)?;
    accounts.margin.set_inner(next);
    oracle::materialize(accounts.group.mode, &mut accounts.btc, &clock)?;
    oracle::materialize(accounts.group.mode, &mut accounts.eth, &clock)?;
    accounts.group.sequence = accounts
        .group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    emit_netting(accounts, clock.slot, cancelled_scaled)
}

#[inline(never)]
fn emit_netting(accounts: &NetMarginClaims, slot: u64, cancelled_scaled: i128) -> Result<()> {
    let emitted = netting_event(accounts, slot, cancelled_scaled);
    crate::event_cpi::emit(&*emitted, accounts.event_authority.to_account_info())?;
    Ok(())
}

#[inline(never)]
fn netting_event(
    accounts: &NetMarginClaims,
    slot: u64,
    cancelled_scaled: i128,
) -> Box<crate::events::MarginClaimsNettedV2> {
    Box::new(crate::events::MarginClaimsNettedV2 {
        group: accounts.group.key(),
        sequence: accounts.group.sequence,
        slot,
        margin: accounts.margin.key(),
        state: crate::events::MarginAccountSnapshotV2::from(&**accounts.margin),
        markets: [&**accounts.btc, &**accounts.eth].map(crate::events::GroupMarketSnapshotV2::from),
        cancelled_scaled,
    })
}

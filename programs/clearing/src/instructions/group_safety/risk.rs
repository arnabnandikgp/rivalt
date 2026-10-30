//! Consenting non-maker receiver; strict whole-root progress after funded fees.
pub(crate) use crate::engine::risk::candidate;
use super::*;
use crate::instructions::group_margin;
use anchor_spl::token::TokenAccount;

#[event_cpi]
#[derive(Accounts)]
pub struct LiquidateGroup<'info> {
    pub receiver_owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"margin-v2", target.portfolio.as_ref(), &target.subaccount_index.to_le_bytes()], bump = target.bump, has_one = group)]
    pub target: Box<Account<'info, MarginAccountV2>>,
    #[account(mut, seeds = [b"margin-v2", receiver.portfolio.as_ref(), &receiver.subaccount_index.to_le_bytes()], bump = receiver.bump, has_one = group,
        constraint = receiver.owner == receiver_owner.key() @ ClearingError::Authority,
        constraint = receiver.key() != target.key() @ ClearingError::Alias)]
    pub receiver: Box<Account<'info, MarginAccountV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}





pub fn liquidate(
    ctx: Context<LiquidateGroup>,
    sequence: u64,
    observations: [u64; 2],
    market_index: u8,
    lots: u64,
    price: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && market_index < 2,
        ClearingError::Profile
    );
    let accounts = &mut *ctx.accounts;
    markets(
        &accounts.group,
        accounts.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    settlement::live(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        sequence,
        observations,
    )?;
    group_margin::trading(&accounts.group, &accounts.target)?;
    group_margin::trading(&accounts.group, &accounts.receiver)?;
    group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    let clock = Clock::get()?;
    let candidate = candidate(
        &accounts.target,
        &accounts.receiver,
        [&accounts.btc, &accounts.eth],
        accounts.group.mode,
        usize::from(market_index),
        lots,
        price,
        &clock,
    )?;
    accounts.target.set_inner(*candidate.target);
    accounts.receiver.set_inner(*candidate.receiver);
    let selected = if market_index == 0 {
        &mut accounts.btc
    } else {
        &mut accounts.eth
    };
    selected.gross_lots = candidate.gross_lots;
    oracle::materialize(accounts.group.mode, &mut accounts.btc, &clock)?;
    oracle::materialize(accounts.group.mode, &mut accounts.eth, &clock)?;
    accounts.group.sequence = next(accounts.group.sequence)?;
    group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    let emitted = liquidation_event(
        accounts,
        market_index,
        lots,
        price,
        candidate.fee,
        candidate.before,
        candidate.after,
        &clock,
    );
    crate::event_cpi::emit(&*emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}

#[inline(never)]
fn liquidation_event(
    accounts: &LiquidateGroup,
    market_index: u8,
    lots: u64,
    price: u64,
    fee: u64,
    before: i128,
    after: i128,
    clock: &Clock,
) -> Box<crate::events::GroupLiquidationV2> {
    Box::new(crate::events::GroupLiquidationV2 {
        group: accounts.group.key(),
        sequence: accounts.group.sequence,
        slot: clock.slot,
        market_index,
        lots,
        price,
        fee: fee,
        deficit_before: before,
        deficit_after: after,
        target: crate::events::MarginAccountSnapshotV2::from(&**accounts.target),
        receiver: crate::events::MarginAccountSnapshotV2::from(&**accounts.receiver),
        markets: [&**accounts.btc, &**accounts.eth].map(crate::events::GroupMarketSnapshotV2::from),
    })
}

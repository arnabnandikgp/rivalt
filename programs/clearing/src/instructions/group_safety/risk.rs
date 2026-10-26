//! Consenting non-maker receiver; strict whole-root progress after funded fees.
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

pub(crate) struct Candidate {
    pub target: Box<MarginAccountV2>,
    pub receiver: Box<MarginAccountV2>,
    pub gross_lots: u64,
    pub fee: u64,
    pub before: i128,
    pub after: i128,
}

#[inline(never)]
pub(crate) fn candidate(
    target: &MarginAccountV2,
    receiver: &MarginAccountV2,
    markets: [&GroupMarketV2; 2],
    mode: u8,
    market_index: usize,
    lots: u64,
    price: u64,
    clock: &Clock,
) -> Result<Candidate> {
    let target_model = group_margin::model(target)?;
    let receiver_model = group_margin::model(receiver)?;
    group_trading::book::validate(target)?;
    group_trading::book::validate(receiver)?;
    require!(
        market_index < 2
            && target.group == receiver.group
            && target_model.allows(market_index)
            && receiver_model.allows(market_index)
            && receiver.role != ROLE_MAKER
            && receiver.cash > 0,
        ClearingError::Liquidation
    );
    let market = markets[market_index];
    oracle::action(market, clock, false)?;
    let risks = risks(mode, markets, clock)?;
    let environment = group_trading::book::Environment {
        markets: markets.map(Some),
        selected: market_index,
        funding: risks.map(|risk| risk.funding),
        slot: clock.slot,
        credible: markets.map(|market| oracle::action(market, clock, false).is_ok()),
    };
    // Target risk orders are cancelled by this candidate. They cannot force an
    // otherwise irrelevant stale market into the exposure valuation universe.
    for (index, position) in target.positions.iter().enumerate() {
        if position.lots != 0 {
            oracle::action(markets[index], clock, false)?;
        }
    }
    environment.admit_sources(receiver, clock, false)?;
    let before = checked(target_model.deficit(risks))?;
    let (next_target, next_receiver, fee) = checked(math::margin::liquidation_candidate(
        target_model,
        receiver_model,
        market_index,
        lots,
        price,
        market.reference_price,
        risks,
    ))?;
    let gross_lots = market
        .gross_lots
        .checked_sub(
            target_model.positions[market_index].lots.unsigned_abs()
                + receiver_model.positions[market_index].lots.unsigned_abs(),
        )
        .and_then(|gross| {
            gross.checked_add(
                next_target.positions[market_index].lots.unsigned_abs()
                    + next_receiver.positions[market_index].lots.unsigned_abs(),
            )
        })
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        gross_lots <= math::MAX_GROSS_LOTS,
        ClearingError::Liquidation
    );
    let mut target = Box::new(target.clone());
    let mut receiver = Box::new(receiver.clone());
    group_margin::commit_model(&mut target, next_target)?;
    group_margin::commit_model(&mut receiver, next_receiver)?;
    for entry in &mut target.book.orders {
        if entry.order.active() && !entry.order.reduce_only {
            entry.order.state = crate::constants::orders::INVALIDATED;
            entry.order.reserve = 0;
        }
    }
    group_trading::book::refresh_with_environment(&mut target, &environment)?;
    group_trading::book::refresh_with_environment(&mut receiver, &environment)?;
    checked(group_margin::model(&receiver)?.admissible(risks))?;
    let after = checked(group_margin::model(&target)?.deficit(risks))?;
    require!(after < before, ClearingError::Liquidation);
    group_trading::advance(&mut target)?;
    group_trading::advance(&mut receiver)?;
    Ok(Candidate {
        target,
        receiver,
        gross_lots,
        fee,
        before,
        after,
    })
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

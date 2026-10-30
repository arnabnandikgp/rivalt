//! One/two-maker atomic routes. Pure candidates are admitted before any root is committed.
pub use crate::engine::routes::GroupOrderAction;
pub(crate) use crate::engine::routes::{manage_candidate, stored_intent, candidate_with_environment};
#[cfg(test)]
pub(crate) use crate::engine::routes::candidate;
use super::*;
use crate::instructions::{OrderExecution, RouteIntent};
use anchor_spl::token::TokenAccount;
use maker_interface::QuoteResponse;

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteGroupRoute<'info> {
    pub actor: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.owner == group.key() && vault.mint == group.quote_mint @ ClearingError::Reconciliation)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"margin-v2", trader.portfolio.as_ref(), &trader.subaccount_index.to_le_bytes()], bump = trader.bump, has_one = group)]
    pub trader: Box<Account<'info, MarginAccountV2>>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, MarginAccountV2>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, MakerRegistrationV2>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: authenticated read-only config is the sole maker CPI account.
    pub first_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, MarginAccountV2>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, MakerRegistrationV2>>>,
    pub second_program: Option<Program<'info>>,
    pub second_program_data: Option<Box<Account<'info, ProgramData>>>,
    /// CHECK: authenticated read-only config is the sole maker CPI account.
    pub second_config: Option<UncheckedAccount<'info>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ManageGroupOrder<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"margin-v2", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = group)]
    pub margin: Box<Account<'info, MarginAccountV2>>,
}



pub fn manage(ctx: Context<ManageGroupOrder>, operation: GroupOrderAction) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    manage_core(ctx.accounts, operation, None, None, &Clock::get()?)
}

pub(crate) fn manage_core(
    accounts: &mut ManageGroupOrder,
    operation: GroupOrderAction,
    mut other_market: Option<&mut Account<GroupMarketV2>>,
    snapshot: Option<(u64, [u64; 2])>,
    clock: &Clock,
) -> Result<()> {
    activated(&accounts.group)?;
    crate::instructions::group_margin::trading(&accounts.group, &accounts.margin)?;
    let delegate_epoch = if matches!(&operation, GroupOrderAction::Cleanup) {
        0
    } else {
        crate::instructions::group_margin::trade_authority(
            &accounts.margin,
            accounts.owner.key(),
            clock.slot,
        )?
    };
    let environment = route_environment(
        &accounts.group,
        &accounts.market,
        other_market.as_deref(),
        snapshot,
        clock,
    )?;
    match &operation {
        GroupOrderAction::Place { terms, .. } | GroupOrderAction::Replace { terms, .. } => {
            environment.admit_sources(&accounts.margin, clock, !terms.reduce_only)?
        }
        GroupOrderAction::Protect { .. } => {
            environment.admit_sources(&accounts.margin, clock, false)?
        }
        GroupOrderAction::Cancel { .. } | GroupOrderAction::Cleanup => {}
    }
    let next = manage_candidate(&accounts.margin, &environment, operation, delegate_epoch)?;
    accounts.margin.set_inner(next);
    oracle::materialize(accounts.group.mode, &mut accounts.market, &clock)?;
    accounts.group.sequence = accounts
        .group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    if let Some(other) = other_market.as_deref_mut() {
        oracle::materialize(accounts.group.mode, other, clock)?;
    }
    emit_order(accounts, other_market.as_deref(), clock.slot)
}

#[inline(never)]
fn emit_order(
    accounts: &ManageGroupOrder,
    other_market: Option<&Account<GroupMarketV2>>,
    slot: u64,
) -> Result<()> {
    let emitted = order_event(&accounts.group, &accounts.market, &accounts.margin, slot);
    if let Some(other) = other_market {
        let whole = crate::events::MarginOrderChangedV2::with_other(
            *emitted,
            other.key(),
            crate::events::GroupMarketSnapshotV2::from(&**other),
        );
        crate::event_cpi::emit(&*whole, accounts.event_authority.to_account_info())
    } else {
        crate::event_cpi::emit(&*emitted, accounts.event_authority.to_account_info())
    }
}

fn route_environment<'a>(
    group: &Account<ClearingGroupV2>,
    selected: &'a Account<GroupMarketV2>,
    other: Option<&'a Account<GroupMarketV2>>,
    snapshot: Option<(u64, [u64; 2])>,
    clock: &Clock,
) -> Result<book::Environment<'a>> {
    match (other, snapshot) {
        (Some(other), Some((sequence, observations))) => {
            crate::instructions::group_margin::environment(
                group,
                group.key(),
                selected,
                other,
                sequence,
                observations,
                clock,
            )
        }
        (None, None) => book::Environment::isolated(
            selected,
            oracle::effective(group.mode, selected, clock)?,
            clock.slot,
            oracle::action(selected, clock, false).is_ok(),
        ),
        _ => err!(ClearingError::Profile),
    }
}



#[inline(never)]
fn order_event(
    group: &Account<ClearingGroupV2>,
    market: &Account<GroupMarketV2>,
    margin: &Account<MarginAccountV2>,
    slot: u64,
) -> Box<crate::events::GroupOrderChangedV2> {
    Box::new(crate::events::GroupOrderChangedV2 {
        group: group.key(),
        sequence: group.sequence,
        slot,
        market: market.key(),
        market_state: crate::events::GroupMarketSnapshotV2::from(&**market),
        margin: margin.key(),
        state: crate::events::MarginAccountSnapshotV2::from(&**margin),
    })
}













pub fn execute(ctx: Context<ExecuteGroupRoute>, intent: RouteIntent) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let clock = Clock::get()?;
    crate::instructions::group_margin::trade_authority(
        &ctx.accounts.trader,
        ctx.accounts.actor.key(),
        clock.slot,
    )?;
    execute_core(ctx.accounts, intent, None, None, None, &clock)
}

pub fn execute_order(ctx: Context<ExecuteGroupRoute>, args: OrderExecution) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let clock = Clock::get()?;
    let (intent, index) = stored_intent(
        &ctx.accounts.group,
        &ctx.accounts.market,
        &ctx.accounts.trader,
        args,
        &clock,
    )?;
    execute_core(ctx.accounts, intent, Some(index), None, None, &clock)
}

pub(crate) fn execute_core(
    accounts: &mut ExecuteGroupRoute,
    intent: RouteIntent,
    order_index: Option<usize>,
    mut other_market: Option<&mut Account<GroupMarketV2>>,
    snapshot: Option<(u64, [u64; 2])>,
    clock: &Clock,
) -> Result<()> {
    activated(&accounts.group)?;
    crate::instructions::group_margin::trading(&accounts.group, &accounts.trader)?;
    crate::instructions::group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    oracle::action(&accounts.market, &clock, !intent.reduce_only)?;
    let has_second = intent.legs.len() == 2;
    require!(
        (1..=2).contains(&intent.legs.len())
            && [
                accounts.second_capital.is_some(),
                accounts.second_registration.is_some(),
                accounts.second_program.is_some(),
                accounts.second_program_data.is_some(),
                accounts.second_config.is_some()
            ]
            .iter()
            .all(|present| *present == has_second),
        ClearingError::RouteIntent
    );
    let environment = route_environment(
        &accounts.group,
        &accounts.market,
        other_market.as_deref(),
        snapshot,
        clock,
    )?;
    environment.admit_sources(&accounts.trader, clock, !intent.reduce_only)?;
    let mut views = vec![makers::View {
        capital: &accounts.first_capital,
        registration: &accounts.first_registration,
        program: &accounts.first_program,
        data: &accounts.first_program_data,
        config: &accounts.first_config,
    }];
    if has_second {
        views.push(makers::View {
            capital: accounts.second_capital.as_deref().unwrap(),
            registration: accounts.second_registration.as_deref().unwrap(),
            program: accounts.second_program.as_ref().unwrap(),
            data: accounts.second_program_data.as_deref().unwrap(),
            config: accounts.second_config.as_ref().unwrap(),
        });
    }
    let mut quotes = Vec::with_capacity(views.len());
    let mut roots = Vec::with_capacity(views.len());
    for (view, leg) in views.iter().zip(&intent.legs) {
        let state = view.authenticate(&accounts.group, &accounts.market)?;
        let request = view.request(
            &accounts.group,
            &accounts.market,
            intent.side,
            leg.lots,
            accounts.market.reference_price,
            clock.slot,
        );
        quotes.push(view.quote(&state, &request)?);
        roots.push((**view.capital).clone());
    }
    let next = candidate_with_environment(
        &accounts.group,
        &accounts.trader,
        &roots,
        &quotes,
        &intent,
        order_index,
        &environment,
        clock,
    )?;
    for (view, root) in views.iter().zip(&next.makers) {
        require!(
            root.positions[usize::from(accounts.market.index)]
                .lots
                .unsigned_abs()
                <= view.registration.inventory_limit,
            ClearingError::RouteHealth
        );
    }
    drop(views);
    let consume = |registration: &mut MakerRegistrationV2, quote: &QuoteResponse| -> Result<()> {
        let consumed = if intent.side == 0 {
            &mut registration.buy_consumed
        } else {
            &mut registration.sell_consumed
        };
        *consumed = maker_interface::consume(*consumed, quote)
            .map_err(|_| error!(ClearingError::MakerResponse))?;
        Ok(())
    };
    consume(&mut accounts.first_registration, &quotes[0])?;
    accounts.first_capital.set_inner(next.makers[0].clone());
    if has_second {
        consume(accounts.second_registration.as_mut().unwrap(), &quotes[1])?;
        accounts
            .second_capital
            .as_mut()
            .unwrap()
            .set_inner(next.makers[1].clone());
    }
    let order = order_index.map(|index| accounts.trader.book.orders[index].order);
    accounts.trader.set_inner(*next.trader);
    accounts.market.gross_lots = next.gross_lots;
    oracle::materialize(accounts.group.mode, &mut accounts.market, &clock)?;
    accounts.group.total_cash = checked(math::cash_sub(accounts.group.total_cash, next.fee))?;
    accounts.group.fees = checked(math::cash_add(accounts.group.fees, next.fee))?;
    accounts.group.sequence = accounts
        .group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    crate::instructions::group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    let mut root_states = Vec::with_capacity(if has_second { 3 } else { 2 });
    root_states.push(crate::events::MarginAccountSnapshotV2::from(
        &**accounts.trader,
    ));
    root_states.push(crate::events::MarginAccountSnapshotV2::from(
        &**accounts.first_capital,
    ));
    let mut maker_states = Vec::with_capacity(if has_second { 2 } else { 1 });
    maker_states.push(crate::events::LegacyMakerRegistrationSnapshotV2::from(
        &**accounts.first_registration,
    ));
    if has_second {
        root_states.push(crate::events::MarginAccountSnapshotV2::from(
            &***accounts.second_capital.as_ref().unwrap(),
        ));
        maker_states.push(crate::events::LegacyMakerRegistrationSnapshotV2::from(
            &***accounts.second_registration.as_ref().unwrap(),
        ));
    }
    let emitted = crate::events::GroupRouteExecutedV2 {
        group: accounts.group.key(),
        sequence: accounts.group.sequence,
        slot: clock.slot,
        market: accounts.market.key(),
        market_state: crate::events::GroupMarketSnapshotV2::from(&**accounts.market),
        nonce: intent.nonce,
        side: intent.side,
        lots: intent.lots,
        gross_quote: next.gross,
        fee: next.fee,
        order_id: order.map(|value| value.id).unwrap_or(0),
        order_version: order.map(|value| value.version).unwrap_or(0),
        root_states,
        maker_states,
        total_cash: accounts.group.total_cash,
        fees: accounts.group.fees,
    };
    if let Some(other) = other_market.as_deref_mut() {
        oracle::materialize(accounts.group.mode, other, clock)?;
        let whole = crate::events::MarginRouteExecutedV2::with_other(
            emitted,
            other.key(),
            crate::events::GroupMarketSnapshotV2::from(&**other),
        );
        crate::event_cpi::emit(&*whole, accounts.event_authority.to_account_info())?;
    } else {
        crate::event_cpi::emit(&emitted, accounts.event_authority.to_account_info())?;
    }
    Ok(())
}

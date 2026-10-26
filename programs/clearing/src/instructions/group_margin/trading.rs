//! Complete two-market dependencies over the existing atomic route/book engine.
use super::*;
use crate::instructions::{group_trading::routes, OrderExecution, RouteIntent};
use routes::*;

#[derive(Accounts)]
pub struct ExecuteMarginRoute<'info> {
    pub route: ExecuteGroupRoute<'info>,
    #[account(mut, seeds = [b"market-v2", route.group.key().as_ref(), &[other_market.index]],
        bump = other_market.bump,
        constraint = other_market.group == route.group.key() @ ClearingError::Profile,
        constraint = other_market.key() != route.market.key() @ ClearingError::Alias)]
    pub other_market: Box<Account<'info, GroupMarketV2>>,
}

#[derive(Accounts)]
pub struct ManageMarginOrder<'info> {
    pub order: ManageGroupOrder<'info>,
    #[account(mut, seeds = [b"market-v2", order.group.key().as_ref(), &[other_market.index]],
        bump = other_market.bump,
        constraint = other_market.group == order.group.key() @ ClearingError::Profile,
        constraint = other_market.key() != order.market.key() @ ClearingError::Alias)]
    pub other_market: Box<Account<'info, GroupMarketV2>>,
}

pub fn execute(
    ctx: Context<ExecuteMarginRoute>,
    sequence: u64,
    observations: [u64; 2],
    intent: RouteIntent,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let clock = Clock::get()?;
    trade_authority(
        &ctx.accounts.route.trader,
        ctx.accounts.route.actor.key(),
        clock.slot,
    )?;
    routes::execute_core(
        &mut ctx.accounts.route,
        intent,
        None,
        Some(&mut ctx.accounts.other_market),
        Some((sequence, observations)),
        &clock,
    )
}

pub fn execute_order(
    ctx: Context<ExecuteMarginRoute>,
    sequence: u64,
    observations: [u64; 2],
    args: OrderExecution,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let clock = Clock::get()?;
    let route = &ctx.accounts.route;
    let (intent, index) =
        routes::stored_intent(&route.group, &route.market, &route.trader, args, &clock)?;
    routes::execute_core(
        &mut ctx.accounts.route,
        intent,
        Some(index),
        Some(&mut ctx.accounts.other_market),
        Some((sequence, observations)),
        &clock,
    )
}

pub fn manage(
    ctx: Context<ManageMarginOrder>,
    sequence: u64,
    observations: [u64; 2],
    operation: routes::GroupOrderAction,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    routes::manage_core(
        &mut ctx.accounts.order,
        operation,
        Some(&mut ctx.accounts.other_market),
        Some((sequence, observations)),
        &Clock::get()?,
    )
}

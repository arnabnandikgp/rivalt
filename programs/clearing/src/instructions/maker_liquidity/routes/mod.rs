//! Current-price canonical execution reuses the whole-account financial engine.
//! No profile-4 activation path is supplied by this module.
use super::*;
use crate::instructions::account_trading::{self as trading, environment, market_view, root_view};
use crate::engine::routes as candidates;
use crate::instructions::{OrderExecution, RouteIntent, RouteLeg};
use crate::state::v2;

mod contract;
use contract::*;
pub use contract::{LiquidityOrderExecution, LiquidityRouteIntent, LiquidityRouteLeg};
mod contexts;
pub use contexts::*;
mod commit;
#[cfg(test)]
mod tests;

pub fn execute(ctx: Context<ExecuteLiquidityRoute>, args: LiquidityRouteIntent) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    args.guard.check(
        &ctx.accounts.identity.venue,
        &ctx.accounts.identity.safety,
        &ctx.accounts.identity.trader,
    )?;
    let clock = Clock::get()?;
    crate::engine::account::trade_authority(
        &*root_view(&ctx.accounts.identity.trader)?,
        ctx.accounts.identity.actor.key(),
        clock.slot,
    )?;
    let intent = RouteIntent {
        domain: args.domain,
        terms_epoch: args.terms_epoch,
        config_epoch: args.config_epoch,
        observation_sequence: ctx.accounts.identity.market.observation_sequence,
        nonce: args.guard.nonce,
        start_slot: args.start_slot,
        expiry_slot: args.expiry_slot,
        side: args.side,
        lots: args.lots,
        all_in_limit: args.all_in_limit,
        max_fee: args.max_fee,
        reduce_only: args.reduce_only,
        generation: args.generation,
        legs: shared_legs(&args.legs),
    };
    execute_core(ctx.accounts, intent, None, &args.legs, &clock)
}

pub fn execute_order(
    ctx: Context<ExecuteLiquidityRoute>,
    args: LiquidityOrderExecution,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    args.guard.check(
        &ctx.accounts.identity.venue,
        &ctx.accounts.identity.safety,
        &ctx.accounts.identity.trader,
    )?;
    let clock = Clock::get()?;
    let domain = Box::new(v2::ClearingGroupV2 {
        domain: ctx.accounts.identity.venue.domain,
        ..Default::default()
    });
    // The current durable order supplies authority, price/fee limits and position generation.
    let (intent, index) = candidates::stored_intent(
        &domain,
        &market_view(&ctx.accounts.identity.market)?,
        &*root_view(&ctx.accounts.identity.trader)?,
        OrderExecution {
            id: args.id,
            version: args.version,
            filled: args.filled,
            observation_sequence: ctx.accounts.identity.market.observation_sequence,
            start_slot: args.start_slot,
            expiry_slot: args.expiry_slot,
            lots: args.lots,
            legs: shared_legs(&args.legs),
        },
        &clock,
    )?;
    execute_core(ctx.accounts, intent, Some(index), &args.legs, &clock)
}

#[inline(never)]
fn execute_core(
    accounts: &mut ExecuteLiquidityRoute,
    intent: RouteIntent,
    order_index: Option<usize>,
    signed_legs: &[LiquidityRouteLeg],
    clock: &Clock,
) -> Result<()> {
    let identity = &accounts.identity;
    execution_profile(
        &identity.venue,
        &identity.custody,
        &identity.safety,
        &identity.market,
    )?;
    require!(identity.safety.mode == ACTIVE, ClearingError::Profile);
    crate::instructions::account_custody::reconciled(
        &identity.custody,
        [&identity.ledger, &identity.other_ledger],
        identity.vault.amount,
    )?;
    let selected = usize::from(identity.market.index);
    require!(
        selected < 2
            && identity.venue.markets[selected] == identity.market.key()
            && identity.venue.markets[1 - selected] == identity.other_market.key()
            && identity.ledger.market_index == identity.market.index
            && identity.other_ledger.market_index == identity.other_market.index,
        ClearingError::Profile
    );
    let has_second = intent.legs.len() == 2;
    require!(
        (1..=2).contains(&intent.legs.len())
            && signed_legs.len() == intent.legs.len()
            && [
                accounts.second_capital.is_some(),
                accounts.second_registration.is_some(),
                accounts.second_program.is_some(),
                accounts.second_program_data.is_some(),
                accounts.second_config.is_some(),
                accounts.second_price.is_some()
            ]
            .iter()
            .all(|present| *present == has_second),
        ClearingError::RouteIntent
    );
    let markets = if selected == 0 {
        [
            market_view(&identity.market)?,
            market_view(&identity.other_market)?,
        ]
    } else {
        [
            market_view(&identity.other_market)?,
            market_view(&identity.market)?,
        ]
    };
    let environment = environment(&markets, selected, clock)?;
    let trader = root_view(&identity.trader)?;
    let mut views = vec![pricing::View {
        capital: &accounts.first_capital,
        registration: &accounts.first_registration,
        program: &accounts.first_program,
        data: &accounts.first_program_data,
        config: &accounts.first_config,
        price: &accounts.first_price,
    }];
    if has_second {
        require_keys_neq!(
            accounts.first_capital.key(),
            accounts.second_capital.as_ref().unwrap().key(),
            ClearingError::Alias
        );
        views.push(pricing::View {
            capital: accounts.second_capital.as_deref().unwrap(),
            registration: accounts.second_registration.as_deref().unwrap(),
            program: accounts.second_program.as_ref().unwrap(),
            data: accounts.second_program_data.as_deref().unwrap(),
            config: accounts.second_config.as_ref().unwrap(),
            price: accounts.second_price.as_ref().unwrap(),
        });
    }
    let mut cache = pricing::CodeApprovalCache::default();
    let mut actual_quotes = Vec::with_capacity(views.len());
    let mut quotes = Vec::with_capacity(views.len());
    for (view, leg) in views.iter().zip(signed_legs) {
        let actual = quote_current(view, accounts, leg, intent.side, clock, &mut cache)?;
        quotes.push(financial_quote(&actual, &identity.market, clock));
        actual_quotes.push(actual);
    }
    let roots = maker_roots(accounts, has_second)?;
    let domain = Box::new(v2::ClearingGroupV2 {
        domain: identity.venue.domain,
        ..Default::default()
    });
    let next = candidates::candidate_for_version(
        &domain,
        &trader,
        &roots,
        &quotes,
        &intent,
        order_index,
        &environment,
        clock,
        4,
    )?;
    drop(views);
    commit::apply(accounts, &intent, order_index, clock, &next, &actual_quotes)
}

/// Construct large root values in their own frame and place them directly in the
/// candidate vector. Avoid temporary boxed copies on the non-reclaiming SBF heap.
#[inline(never)]
fn maker_roots(accounts: &ExecuteLiquidityRoute, has_second: bool) -> Result<Vec<v2::MarginAccountV2>> {
    let mut roots = Vec::with_capacity(if has_second { 2 } else { 1 });
    roots.push(trading::root_view_value(&accounts.first_capital)?);
    if has_second {
        roots.push(trading::root_view_value(accounts.second_capital.as_deref().unwrap())?);
    }
    Ok(roots)
}

/// Keep decoded curve/request temporaries out of the financial engine's frame.
/// All original authentication, canonical CPI verification and code-cache checks
/// remain; this boundary changes stack lifetime, not admission or wire semantics.
#[inline(never)]
fn quote_current(
    view: &pricing::View,
    accounts: &ExecuteLiquidityRoute,
    leg: &LiquidityRouteLeg,
    side: u8,
    clock: &Clock,
    cache: &mut pricing::CodeApprovalCache,
) -> Result<canonical::MakerQuoteResponse> {
    let identity = &accounts.identity;
    let state = view.authenticate(&identity.venue, &identity.market, &accounts.registry, cache)?;
    validate_leg(leg, view.registration, &state.config)?;
    let request = view.request(&identity.venue, &identity.market, &state, side, leg.lots);
    view.quote(&state, &request, clock)
}

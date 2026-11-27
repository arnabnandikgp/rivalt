//! Current-price canonical execution reuses the whole-account financial engine.
//! No profile-4 activation path is supplied by this module.
use super::*;
use crate::engine::routes as candidates;
use crate::instructions::account_trading::{
    self as trading, market_view, optional_environment, root_view,
};
use crate::instructions::{OrderExecution, RouteIntent, RouteLeg};
use crate::state::{OrderBook, Position, Protection, StoredOrder};

mod contract;
mod market_order;
#[cfg(feature = "listed-margin-storage")]
pub(crate) mod listed;
pub use market_order::{execute_best, execute_multi, BestRouteIntent, MakerEpochs, MultiRouteIntent};
mod liquidation;
use contract::*;
pub use contract::{LiquidityOrderExecution, LiquidityRouteIntent, LiquidityRouteLeg};
mod contexts;
pub use contexts::*;
mod commit;
#[cfg(test)]
mod tests;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum RoutePath { Serial, ReadOnlyMarket, ReadOnlyLedger }

/// Fixed-leg routes place all market accounting on the same physical lane
/// as the ordinary router. Scope capture has checked the type, ownership,
/// writable privilege and uniqueness of every extra account before entry.
fn explicit_lane(
    registry: &LiquidityRegistry, first: &MakerRegistration, remaining: &[AccountView],
) -> Result<Option<BorshAccount<MakerRegistration>>> {
    if first.instance < 3 {
        require!(remaining.is_empty(), ClearingError::MakerBinding);
        return Ok(None);
    }
    let lane_id = first.instance % 3;
    let [view] = remaining else { return Err(ClearingError::MakerBinding.into()); };
    require!(cfg!(feature = "wide-maker-discovery") && first.instance < registry.count
        && view.address() == &registry.registrations[usize::from(lane_id)], ClearingError::MakerBinding);
    // SAFETY: the scope rejects duplicates including named accounts. The
    // registration PDA is unique, writable, clearing-owned and typed.
    let lane = unsafe { BorshAccount::<MakerRegistration>::load_mut(view.clone()) }?;
    require!(lane.instance == lane_id && lane.venue == first.venue && lane.market == first.market,
        ClearingError::MakerBinding);
    Ok(Some(lane))
}

pub fn execute(
    ctx: &mut Context<ExecuteLiquidityRoute>,
    events: &mut crate::event_cpi::Payloads,
    args: LiquidityRouteIntent,
    forced: bool,
) -> Result<()> {
    let remaining = crate::scoped_history::economic_accounts(ctx)?;
    let lane = explicit_lane(&ctx.accounts.registry, &ctx.accounts.first_registration, &remaining)?;
    execute_intent(&mut ctx.accounts.view(), events, args, forced, RoutePath::Serial, lane)
}

pub fn execute_lane(
    ctx: &mut Context<ExecuteMarketLane>,
    events: &mut crate::event_cpi::Payloads,
    args: LiquidityRouteIntent,
) -> Result<()> {
    require!(cfg!(feature = "read-only-route-market"), ClearingError::Profile);
    let remaining = crate::scoped_history::economic_accounts(ctx)?;
    let lane = explicit_lane(&ctx.accounts.registry, &ctx.accounts.first_registration, &remaining)?;
    execute_intent(&mut ctx.accounts.view(), events, args, false, RoutePath::ReadOnlyMarket, lane)
}

pub fn execute_ledger_lane(ctx: &mut Context<ExecuteLedgerLane>, events: &mut crate::event_cpi::Payloads, args: LiquidityRouteIntent) -> Result<()> {
    require!(cfg!(feature = "read-only-route-ledger"), ClearingError::Profile);
    let remaining = crate::scoped_history::economic_accounts(ctx)?;
    let lane = explicit_lane(&ctx.accounts.registry, &ctx.accounts.first_registration, &remaining)?;
    execute_intent(&mut ctx.accounts.view(), events, args, false, RoutePath::ReadOnlyLedger, lane)
}

fn execute_intent(
    accounts: &mut RouteAccounts<'_>,
    events: &mut crate::event_cpi::Payloads,
    args: LiquidityRouteIntent,
    forced: bool,
    path: RoutePath,
    lane: Option<BorshAccount<MakerRegistration>>,
) -> Result<()> {
    args.guard.check(
        &accounts.identity.venue,
        &accounts.identity.safety,
        &accounts.identity.trader,
    )?;
    let clock = Clock::get()?;
    if forced {
        require!(args.reduce_only && args.generation.is_some(), ClearingError::Liquidation);
    } else {
        crate::engine::account::trade_authority(
            &*root_view(&accounts.identity.trader)?,
            accounts.identity.actor.address().to_owned(),
            clock.slot,
        )?;
    }
    let intent = RouteIntent {
        domain: args.domain,
        terms_epoch: args.terms_epoch,
        config_epoch: args.config_epoch,
        observation_sequence: accounts.identity.market.observation_sequence,
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
    execute_core(accounts, events, intent, None, forced, path, &args.legs, &clock, lane)
}

pub fn execute_order(
    ctx: &mut Context<ExecuteLiquidityRoute>,
    events: &mut crate::event_cpi::Payloads,
    args: LiquidityOrderExecution,
) -> Result<()> {
    let remaining = crate::scoped_history::economic_accounts(ctx)?;
    let lane = explicit_lane(&ctx.accounts.registry, &ctx.accounts.first_registration, &remaining)?;
    args.guard.check(
        &ctx.accounts.identity.venue,
        &ctx.accounts.identity.safety,
        &ctx.accounts.identity.trader,
    )?;
    let clock = Clock::get()?;
    let venue = &ctx.accounts.identity.venue;
    // The current durable order supplies authority, price/fee limits and position generation.
    let (intent, index) = candidates::stored_intent(
        venue,
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
    execute_core(
        &mut ctx.accounts.view(),
        events,
        intent,
        Some(index),
        false,
        RoutePath::Serial,
        &args.legs,
        &clock,
        lane,
    )
}

#[inline(never)]
fn execute_core(
    accounts: &mut RouteAccounts<'_>,
    events: &mut crate::event_cpi::Payloads,
    intent: RouteIntent,
    order_index: Option<usize>,
    forced: bool,
    path: RoutePath,
    signed_legs: &[LiquidityRouteLeg],
    clock: &Clock,
    mut lane: Option<BorshAccount<MakerRegistration>>,
) -> Result<()> {
    let identity = &accounts.identity;
    execution_profile(&identity.venue, &identity.safety, &identity.market)?;
    require!(identity.safety.mode == ACTIVE, ClearingError::Profile);
    if path != RoutePath::Serial {
        require!(cfg!(feature = "read-only-route-market") && identity.other_market.is_none() && identity.other_ledger.is_none(),
            ClearingError::Profile);
        let held = &identity.market.oracle;
        // In this interval the original observation determines the exact index
        // directly. Outside it use the checkpointed ordinary route.
        require!(held.held_epoch == identity.market.config_epoch && held.held_until > held.sampled_at &&
            clock.slot >= identity.market.valid_from && clock.slot < held.held_slot &&
            clock.unix_timestamp >= held.sampled_at && clock.unix_timestamp <= held.held_until,
            ClearingError::MarketCheckpoint);
    }
    let selected = usize::from(identity.market.index);
    require!(
        selected < 2
            && identity.venue.markets[selected] == identity.market.address().to_owned()
            && identity
                .other_market
                .as_ref()
                .is_none_or(
                    |market| identity.venue.markets[1 - selected] == market.address().to_owned()
                )
            && identity.ledger.market_index == identity.market.index
            && identity
                .other_ledger
                .as_ref()
                .is_none_or(|ledger| usize::from(ledger.market_index) == 1 - selected),
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
    let mut markets = if selected == 0 {
        [
            Some(market_view(&identity.market)?),
            identity
                .other_market
                .as_deref()
                .map(|market| market_view(market))
                .transpose()?,
        ]
    } else {
        [
            identity
                .other_market
                .as_deref()
                .map(|market| market_view(market))
                .transpose()?,
            Some(market_view(&identity.market)?),
        ]
    };
    if path != RoutePath::Serial {
        // The ordinary financial engine also checks the total of its touched
        // roots. The lane independently enforces the complete market cap.
        let mut touched = identity.trader.positions[selected].lots.unsigned_abs()
            .checked_add(accounts.first_capital.positions[selected].lots.unsigned_abs()).ok_or(ClearingError::Arithmetic)?;
        if let Some(second) = accounts.second_capital.as_ref() {
            touched = touched.checked_add(second.positions[selected].lots.unsigned_abs()).ok_or(ClearingError::Arithmetic)?;
        }
        markets[selected].as_mut().ok_or(ClearingError::Profile)?.gross_lots = touched;
    }
    let environment =
        optional_environment(markets.each_ref().map(Option::as_ref), selected, clock)?;
    environment.validate(&identity.trader)?;
    environment.validate(&accounts.first_capital)?;
    if let Some(capital) = accounts.second_capital.as_deref() {
        environment.validate(capital)?;
    }
    let mut trader = root_view(&identity.trader)?;
    let liquidation = if forced {
        Some(liquidation::prepare(&mut trader, &environment, clock)?)
    } else {
        None
    };
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
            accounts.first_capital.address().to_owned(),
            accounts
                .second_capital
                .as_ref()
                .unwrap()
                .address()
                .to_owned(),
            ClearingError::Alias
        );
        views.push(pricing::View {
            capital: accounts.second_capital.as_deref().unwrap(),
            registration: accounts.second_registration.as_deref().unwrap(),
            program: accounts.second_program.unwrap(),
            data: accounts.second_program_data.unwrap(),
            config: accounts.second_config.unwrap(),
            price: accounts.second_price.unwrap(),
        });
    }
    let mut cache = pricing::CodeApprovalCache::default();
    let mut actual_quotes = Vec::with_capacity(views.len());
    let mut quotes = Vec::with_capacity(views.len());
    for (view, leg) in views.iter().zip(signed_legs) {
        let actual = quote_current(view, accounts, leg, intent.side, clock, &mut cache)?;
        if forced {
            liquidation::check_price(&actual, &identity.market)?;
        }
        quotes.push(financial_quote(&actual, &identity.market, clock));
        actual_quotes.push(actual);
    }
    let roots = maker_roots(accounts, has_second)?;
    let venue = &identity.venue;
    profile_cu!("financial-candidate-enter");
    let next = candidates::candidate_for_version(
        venue,
        &trader,
        &roots,
        &quotes,
        &intent,
        order_index,
        &environment,
        clock,
        4,
    )?;
    profile_cu!("financial-candidate-exit");
    if let Some(before) = liquidation {
        before.check_progress(&next.trader, &environment, intent.lots)?;
    }
    drop(views);
    profile_cu!("route-commit-enter");
    commit::apply(
        accounts,
        events,
        &intent,
        order_index,
        clock,
        &next,
        &actual_quotes,
        path,
        lane.as_mut(),
    )?;
    if let Some(mut external) = lane { external.exit()?; }
    Ok(())
}

/// Construct large root values in their own frame and place them directly in the
/// candidate vector. Avoid temporary boxed copies on the non-reclaiming SBF heap.
#[inline(never)]
fn maker_roots(accounts: &RouteAccounts<'_>, has_second: bool) -> Result<Vec<MarginAccount>> {
    let mut roots = Vec::with_capacity(if has_second { 2 } else { 1 });
    roots.push(trading::root_view_value(&accounts.first_capital)?);
    if has_second {
        roots.push(trading::root_view_value(
            accounts.second_capital.as_deref().unwrap(),
        )?);
    }
    Ok(roots)
}

/// Keep decoded curve/request temporaries out of the financial engine's frame.
/// All original authentication, canonical CPI verification and code-cache checks
/// remain; this boundary changes stack lifetime, not admission or wire semantics.
#[inline(never)]
fn quote_current(
    view: &pricing::View,
    accounts: &RouteAccounts<'_>,
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

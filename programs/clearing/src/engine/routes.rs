//! Atomic route and stored-order candidates; no account writes or token CPI.
use super::*;
use crate::instructions::{OrderExecution, OrderTerms, RouteIntent};
use maker_interface::QuoteResponse;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum GroupOrderAction {
    Place {
        expected_id: u64,
        terms: OrderTerms,
    },
    Replace {
        id: u64,
        version: u64,
        terms: OrderTerms,
    },
    Protect {
        expected_id: u64,
        take_profit: OrderTerms,
        stop_loss: OrderTerms,
    },
    Cancel {
        id: u64,
        version: u64,
        protection_group: bool,
    },
    Cleanup,
}

/// Shared book transition; entrypoints authenticate actor, canonical dependencies
/// and relevant source actions before using this candidate.
#[inline(never)]
pub(crate) fn manage_candidate(
    root: &MarginAccountV2,
    environment: &book::Environment,
    operation: GroupOrderAction,
    delegate_epoch: u64,
) -> Result<MarginAccountV2> {
    match operation {
        GroupOrderAction::Place { expected_id, terms } => {
            book::place_with_environment(root, environment, expected_id, terms, delegate_epoch)
        }
        GroupOrderAction::Replace { id, version, terms } => {
            book::replace_with_environment(root, environment, id, version, terms, delegate_epoch)
        }
        GroupOrderAction::Protect {
            expected_id,
            take_profit,
            stop_loss,
        } => book::protect_with_environment(
            root,
            environment,
            expected_id,
            take_profit,
            stop_loss,
            delegate_epoch,
        ),
        GroupOrderAction::Cancel {
            id,
            version,
            protection_group,
        } => book::cancel_with_environment(root, environment, id, version, protection_group),
        GroupOrderAction::Cleanup => {
            let mut next = root.clone();
            book::validate(&next)?;
            book::refresh_with_environment(&mut next, environment)?;
            require!(
                next.reserved != root.reserved
                    || next.book.reserve_observations != root.book.reserve_observations
                    || next
                        .book
                        .orders
                        .iter()
                        .zip(&root.book.orders)
                        .any(|(current, previous)| current.order.state != previous.order.state),
                ClearingError::OrderState
            );
            advance(&mut next)?;
            Ok(next)
        }
    }
}

pub(crate) fn stored_intent(
    group: &ClearingGroupV2,
    market: &GroupMarketV2,
    trader: &MarginAccountV2,
    args: OrderExecution,
    clock: &Clock,
) -> Result<(RouteIntent, usize)> {
    book::validate(trader)?;
    require!(
        trader.group == market.group && model(trader)?.allows(usize::from(market.index)),
        ClearingError::OrderState
    );
    let index = book::find(trader, args.id, args.version)?;
    let stored = trader.book.orders[index];
    require!(
        stored.market_index == market.index
            && super::account::live_order_authority(
                trader,
                stored.delegate_epoch,
                clock.slot
            ),
        ClearingError::Authority
    );
    let order = stored.order;
    require!(
        order.filled == args.filled
            && order.terms_epoch == market.terms_epoch
            && clock.slot >= order.start_slot
            && clock.slot < order.expiry_slot
            && args.lots > 0
            && args.lots <= book::eligible(trader, &order)?,
        ClearingError::OrderState
    );
    require!(
        order.trigger == 0
            || (order.trigger == 1 && market.reference_price >= order.threshold)
            || (order.trigger == 2 && market.reference_price <= order.threshold),
        ClearingError::OrderTrigger
    );
    Ok((
        RouteIntent {
            domain: group.domain,
            terms_epoch: order.terms_epoch,
            config_epoch: market.config_epoch,
            observation_sequence: args.observation_sequence,
            nonce: trader.nonce,
            start_slot: args.start_slot,
            expiry_slot: args.expiry_slot,
            side: order.side,
            lots: args.lots,
            all_in_limit: order
                .limit
                .checked_mul(args.lots)
                .ok_or(ClearingError::Arithmetic)?,
            max_fee: order.fee_budget - order.fee_charged,
            reduce_only: order.reduce_only,
            generation: if order.reduce_only {
                Some(order.generation)
            } else {
                None
            },
            legs: args.legs,
        },
        index,
    ))
}

pub(crate) struct Candidate {
    pub trader: Box<MarginAccountV2>,
    pub makers: Vec<MarginAccountV2>,
    pub fee: u64,
    pub gross: u64,
    pub gross_lots: u64,
}

pub(crate) fn candidate(
    group: &ClearingGroupV2,
    market: &GroupMarketV2,
    trader: &MarginAccountV2,
    makers: &[MarginAccountV2],
    quotes: &[QuoteResponse],
    intent: &RouteIntent,
    order_index: Option<usize>,
    funding: i128,
    clock: &Clock,
) -> Result<Candidate> {
    let environment = book::Environment::isolated(market, funding, clock.slot, true)?;
    candidate_with_environment(
        group,
        trader,
        makers,
        quotes,
        intent,
        order_index,
        &environment,
        clock,
    )
}

pub(crate) fn candidate_with_environment(
    group: &ClearingGroupV2,
    trader: &MarginAccountV2,
    makers: &[MarginAccountV2],
    quotes: &[QuoteResponse],
    intent: &RouteIntent,
    order_index: Option<usize>,
    environment: &book::Environment,
    clock: &Clock,
) -> Result<Candidate> {
    candidate_for_version(
        group,
        trader,
        makers,
        quotes,
        intent,
        order_index,
        environment,
        clock,
        maker_interface::GROUP_VERSION,
    )
}

pub(crate) fn candidate_for_version(
    group: &ClearingGroupV2,
    trader: &MarginAccountV2,
    makers: &[MarginAccountV2],
    quotes: &[QuoteResponse],
    intent: &RouteIntent,
    order_index: Option<usize>,
    environment: &book::Environment,
    clock: &Clock,
    quote_version: u16,
) -> Result<Candidate> {
    environment.validate(trader)?;
    let market = environment.market(environment.selected)?;
    let trader_model = model(trader)?;
    book::validate(trader)?;
    require!(
        trader.group == market.group
            && trader_model.allows(usize::from(market.index))
            && makers.len() == quotes.len()
            && makers.len() == intent.legs.len()
            && (1..=2).contains(&makers.len())
            && intent.domain == group.domain
            && intent.terms_epoch == market.terms_epoch
            && intent.config_epoch == market.config_epoch
            && intent.observation_sequence == market.observation_sequence
            && intent.nonce == trader.nonce
            && intent.side <= 1
            && (1..=4608).contains(&intent.lots)
            && clock.slot >= intent.start_slot
            && clock.slot < intent.expiry_slot
            && intent
                .expiry_slot
                .checked_sub(intent.start_slot)
                .is_some_and(|duration| duration <= 150),
        ClearingError::RouteIntent
    );
    environment.admit_sources(trader, clock, !intent.reduce_only)?;
    let position = trader.positions[usize::from(market.index)];
    if let Some(generation) = intent.generation {
        require!(
            generation == position.generation,
            ClearingError::RouteIntent
        );
    }
    if intent.reduce_only {
        require!(
            intent.generation == Some(position.generation)
                && position.lots != 0
                && intent.lots <= position.lots.unsigned_abs()
                && ((intent.side == 0) == (position.lots < 0)),
            ClearingError::RouteIntent
        );
    }
    let mut gross = 0;
    let mut lots = 0u64;
    let mut models = Vec::with_capacity(makers.len());
    let mut legs = Vec::with_capacity(makers.len());
    for (index, ((maker, quote), leg)) in makers.iter().zip(quotes).zip(&intent.legs).enumerate() {
        require!(
            maker.group == trader.group
                && maker.role == ROLE_MAKER
                && maker.owner != trader.owner
                && maker.id != trader.id
                && !makers[..index].iter().any(|other| other.id == maker.id)
                && !quotes[..index]
                    .iter()
                    .any(|other| other.maker_id == quote.maker_id),
            ClearingError::Alias
        );
        book::validate(maker)?;
        models.push(model(maker)?);
        require!(
            quote.version == quote_version
                && quote.side == intent.side
                && quote.lots == leg.lots
                && quote.lots > 0
                && quote.quote_epoch == leg.quote_epoch
                && quote.authority_epoch == leg.authority_epoch
                && quote.terms_epoch == intent.terms_epoch
                && quote.market_config_epoch == intent.config_epoch
                && u128::from(quote.gross_quote) * 10
                    >= u128::from(quote.lots) * u128::from(market.reference_price) * 9
                && u128::from(quote.gross_quote) * 10
                    <= u128::from(quote.lots) * u128::from(market.reference_price) * 11,
            ClearingError::RouteLimit
        );
        gross = checked(math::cash_add(gross, quote.gross_quote))?;
        lots = lots
            .checked_add(quote.lots)
            .ok_or(ClearingError::Arithmetic)?;
        legs.push((quote.lots, quote.gross_quote));
    }
    require!(lots == intent.lots, ClearingError::RouteIntent);
    let prefix = order_index
        .map(|index| trader.book.orders[index].order.notional)
        .unwrap_or(0);
    let (next, next_makers, fee) = checked(math::margin::route_candidate(
        trader_model,
        &models,
        usize::from(market.index),
        &legs,
        intent.side,
        environment.funding,
        prefix,
    ))?;
    require!(
        fee <= intent.max_fee
            && if intent.side == 0 {
                gross
                    .checked_add(fee)
                    .is_some_and(|total| total <= intent.all_in_limit)
            } else {
                gross
                    .checked_sub(fee)
                    .is_some_and(|total| total >= intent.all_in_limit)
            },
        ClearingError::RouteLimit
    );
    let mut trader_next = Box::new(trader.clone());
    commit_model(&mut trader_next, next)?;
    if let Some(index) = order_index {
        book::consume(&mut trader_next, index, intent.lots, gross, fee)?;
    }
    trader_next.nonce = trader_next
        .nonce
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    book::refresh_with_environment(&mut trader_next, environment)?;
    let risks = environment.risks();
    let admitted = if intent.reduce_only {
        trader_model.admit_reduction(&model(&trader_next)?, usize::from(market.index), risks)
    } else {
        model(&trader_next)?.admissible(risks)
    };
    admitted.map_err(|_| error!(ClearingError::RouteHealth))?;
    advance(&mut trader_next)?;
    let mut makers_next = makers.to_vec();
    for (maker, next_model) in makers_next.iter_mut().zip(next_makers) {
        finish_maker(maker, next_model, market, clock.slot, risks)?;
    }
    let market_index = usize::from(market.index);
    let before = trader.positions[market_index].lots.unsigned_abs()
        + makers
            .iter()
            .map(|root| root.positions[market_index].lots.unsigned_abs())
            .sum::<u64>();
    let after = trader_next.positions[market_index].lots.unsigned_abs()
        + makers_next
            .iter()
            .map(|root| root.positions[market_index].lots.unsigned_abs())
            .sum::<u64>();
    let gross_lots = market
        .gross_lots
        .checked_sub(before)
        .and_then(|gross| gross.checked_add(after))
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        gross_lots <= math::MAX_GROSS_LOTS,
        ClearingError::RouteHealth
    );
    Ok(Candidate {
        trader: trader_next,
        makers: makers_next,
        fee,
        gross,
        gross_lots,
    })
}

#[inline(never)]
pub(crate) fn finish_maker(
    root: &mut MarginAccountV2,
    candidate: math::margin::Margin,
    market: &GroupMarketV2,
    slot: u64,
    risks: [math::margin::Risk; 2],
) -> Result<()> {
    commit_model(root, candidate)?;
    book::refresh(root, market, slot, true)?;
    model(root)?
        .admissible(risks)
        .map_err(|_| error!(ClearingError::RouteHealth))?;
    advance(root)
}

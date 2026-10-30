//! Four orders and two protections belong to one root, with explicit market/generation binding.
use super::account::{live_order_authority, model};
use super::*;
mod environment;
use crate::{
    constants::orders::*,
    instructions::OrderTerms,
    state::{OrderRecord, ProtectiveGroup},
};
pub(crate) use environment::Environment;

fn bound(root: &MarginAccount, market: &Market) -> Result<()> {
    model(root)?;
    require!(
        market.schema_version == SCHEMA_VERSION
            && market.venue == root.venue
            && model(root)?.allows(usize::from(market.index)),
        ClearingError::OrderState
    );
    Ok(())
}

pub(crate) fn validate(root: &MarginAccount) -> Result<()> {
    let account = model(root)?;
    let mut reserved = 0;
    for (index, stored) in root.book.orders.iter().enumerate() {
        let order = &stored.order;
        require!(
            order.state <= INVALIDATED && order.id <= root.book.last_order_id,
            ClearingError::OrderState
        );
        if order.active() {
            require!(
                account.allows(usize::from(stored.market_index))
                    && stored.delegate_epoch <= root.delegate_epoch
                    && order.id > 0
                    && order.version > 0
                    && order.side <= 1
                    && order.filled < order.lots
                    && order.lots <= 4608
                    && order.fee_charged == checked(math::fee_total(order.notional))?
                    && order.fee_charged <= order.fee_budget
                    && !root.book.orders[..index]
                        .iter()
                        .any(|other| other.order.active() && other.order.id == order.id),
                ClearingError::OrderState
            );
            if order.group_id > 0 {
                let protection = root
                    .book
                    .protections
                    .iter()
                    .find(|entry| entry.protection.id == order.group_id)
                    .ok_or(ClearingError::OrderState)?;
                require!(
                    protection.market_index == stored.market_index
                        && order.reduce_only
                        && protection.protection.id <= root.book.last_group_id
                        && protection.protection.generation == order.generation
                        && protection.protection.side == order.side
                        && protection.protection.remaining <= protection.protection.original,
                    ClearingError::OrderState
                );
            }
            reserved = checked(math::cash_add(reserved, order.reserve))?;
        } else {
            require!(order.reserve == 0, ClearingError::OrderState);
        }
    }
    require!(reserved == root.reserved, ClearingError::OrderState);
    Ok(())
}

pub(crate) fn eligible(root: &MarginAccount, order: &OrderRecord) -> Result<u64> {
    let market_index = root
        .book
        .orders
        .iter()
        .find(|entry| entry.order.id == order.id && entry.order.version == order.version)
        .map(|entry| usize::from(entry.market_index))
        .ok_or(ClearingError::OrderState)?;
    require!(model(root)?.allows(market_index), ClearingError::OrderState);
    let mut remaining = order
        .lots
        .checked_sub(order.filled)
        .ok_or(ClearingError::OrderState)?;
    if order.reduce_only {
        remaining = remaining.min(root.positions[market_index].lots.unsigned_abs());
    }
    if order.group_id > 0 {
        remaining = remaining.min(
            root.book
                .protections
                .iter()
                .find(|entry| entry.protection.id == order.group_id)
                .ok_or(ClearingError::OrderState)?
                .protection
                .remaining,
        );
    }
    Ok(remaining)
}

pub(crate) fn refresh(
    root: &mut MarginAccount,
    market: &Market,
    slot: u64,
    credible: bool,
) -> Result<()> {
    refresh_with_environment(root, &Environment::isolated(market, 0, slot, credible)?)
}

pub(crate) fn refresh_with_environment(
    root: &mut MarginAccount,
    environment: &Environment,
) -> Result<()> {
    environment.validate(root)?;
    let live_delegate =
        root.delegate != Pubkey::default() && environment.slot < root.delegate_expiry_slot;
    for stored in &mut root.book.orders {
        let order = &mut stored.order;
        if !order.active() {
            order.reserve = 0;
            continue;
        }
        let market = environment.market(usize::from(stored.market_index))?;
        let position = root.positions[usize::from(stored.market_index)];
        if environment.slot >= order.expiry_slot {
            order.state = EXPIRED;
        } else if (stored.delegate_epoch != 0
            && (!live_delegate || stored.delegate_epoch != root.delegate_epoch))
            || order.terms_epoch != market.terms_epoch
            || (order.reduce_only
                && (position.lots == 0
                    || position.generation != order.generation
                    || ((order.side == 0) != (position.lots < 0))))
            || (order.group_id > 0
                && root
                    .book
                    .protections
                    .iter()
                    .find(|entry| {
                        entry.protection.id == order.group_id
                            && entry.market_index == stored.market_index
                    })
                    .is_none_or(|entry| entry.protection.remaining == 0))
        {
            order.state = INVALIDATED;
        }
        if !order.active() {
            order.reserve = 0;
        }
    }
    root.reserved = 0;
    for index in 0..4 {
        let stored = root.book.orders[index];
        let order = stored.order;
        if order.active() {
            let market_index = usize::from(stored.market_index);
            let market = environment.market(market_index)?;
            let (lower, upper) = if environment.credible[market_index] {
                (market.lower, market.upper)
            } else {
                (1, math::MAX_PRICE)
            };
            let reserve = checked(math::orders::reserve(
                eligible(root, &order)?,
                order.limit,
                order
                    .fee_budget
                    .checked_sub(order.fee_charged)
                    .ok_or(ClearingError::OrderState)?,
                order.side,
                order.reduce_only,
                lower,
                upper,
            ))?;
            root.book.orders[index].order.reserve = reserve;
            root.reserved = checked(math::cash_add(root.reserved, reserve))?;
        }
    }
    for (index, market) in environment.markets.iter().enumerate() {
        if let Some(market) = market {
            root.book.reserve_observations[index] = market.observation_sequence;
        }
    }
    validate(root)
}

fn terms(
    root: &MarginAccount,
    market_index: usize,
    terms: &OrderTerms,
    slot: u64,
    filled: u64,
) -> Result<()> {
    require!(
        terms.side <= 1
            && terms.lots > filled
            && terms.lots <= 4608
            && (9_000..=110_000).contains(&terms.limit)
            && terms.fee_budget <= 1_000_000
            && terms.expiry_slot > slot
            && terms.expiry_slot > terms.start_slot
            && terms.expiry_slot - terms.start_slot <= MAX_ORDER_SLOTS
            && terms.expiry_slot - slot <= MAX_ORDER_SLOTS
            && terms.trigger <= 2
            && ((terms.trigger == 0 && terms.threshold == 0)
                || (terms.trigger > 0 && (10_000..=100_000).contains(&terms.threshold))),
        ClearingError::OrderTerms
    );
    let position = root.positions[market_index];
    if terms.reduce_only {
        require!(
            position.lots != 0
                && terms.lots - filled <= position.lots.unsigned_abs()
                && terms.generation == position.generation
                && ((terms.side == 0) == (position.lots < 0)),
            ClearingError::OrderTerms
        );
    } else {
        require!(terms.generation == 0, ClearingError::OrderTerms);
    }
    Ok(())
}

fn add(
    root: &mut MarginAccount,
    market: &Market,
    terms: OrderTerms,
    group_id: u64,
    delegate_epoch: u64,
) -> Result<()> {
    let index = root
        .book
        .orders
        .iter()
        .position(|entry| !entry.order.active())
        .ok_or(ClearingError::OrderSlots)?;
    root.book.last_order_id = root
        .book
        .last_order_id
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    root.book.orders[index] = StoredOrder {
        market_index: market.index,
        delegate_epoch,
        order: OrderRecord {
            id: root.book.last_order_id,
            version: 1,
            state: OPEN,
            side: terms.side,
            original_lots: terms.lots,
            lots: terms.lots,
            fee_budget: terms.fee_budget,
            limit: terms.limit,
            start_slot: terms.start_slot,
            expiry_slot: terms.expiry_slot,
            trigger: terms.trigger,
            threshold: terms.threshold,
            reduce_only: terms.reduce_only,
            generation: terms.generation,
            group_id,
            terms_epoch: market.terms_epoch,
            ..OrderRecord::default()
        },
    };
    Ok(())
}

fn finish(mut next: MarginAccount, environment: &Environment) -> Result<MarginAccount> {
    let accrued = checked(model(&next)?.accrued(environment.funding))?;
    super::markets::commit_model(&mut next, accrued, environment.markets)?;
    refresh_with_environment(&mut next, environment)?;
    model(&next)?
        .admissible(environment.risks())
        .map_err(|_| error!(ClearingError::RouteHealth))?;
    advance(&mut next)?;
    Ok(next)
}

pub(crate) fn place_with_environment(
    root: &MarginAccount,
    environment: &Environment,
    expected_id: u64,
    order_terms: OrderTerms,
    delegate_epoch: u64,
) -> Result<MarginAccount> {
    environment.validate(root)?;
    let market = environment.market(environment.selected)?;
    let slot = environment.slot;
    require!(
        live_order_authority(root, delegate_epoch, slot),
        ClearingError::Authority
    );

    bound(root, market)?;
    validate(root)?;
    terms(root, environment.selected, &order_terms, slot, 0)?;
    let mut next = root.clone();
    refresh_with_environment(&mut next, environment)?;
    require!(
        next.book.last_order_id.checked_add(1) == Some(expected_id),
        ClearingError::OrderState
    );
    add(&mut next, market, order_terms, 0, delegate_epoch)?;
    finish(next, environment)
}

pub(crate) fn find(root: &MarginAccount, id: u64, version: u64) -> Result<usize> {
    root.book
        .orders
        .iter()
        .position(|entry| {
            entry.order.active() && entry.order.id == id && entry.order.version == version
        })
        .ok_or_else(|| error!(ClearingError::OrderState))
}

pub(crate) fn replace_with_environment(
    root: &MarginAccount,
    environment: &Environment,
    id: u64,
    version: u64,
    order_terms: OrderTerms,
    delegate_epoch: u64,
) -> Result<MarginAccount> {
    environment.validate(root)?;
    let market = environment.market(environment.selected)?;
    let slot = environment.slot;
    require!(
        live_order_authority(root, delegate_epoch, slot),
        ClearingError::Authority
    );

    bound(root, market)?;
    validate(root)?;
    let mut next = root.clone();
    refresh_with_environment(&mut next, environment)?;
    let index = find(&next, id, version)?;
    require!(
        usize::from(next.book.orders[index].market_index) == environment.selected,
        ClearingError::OrderState
    );
    let old = next.book.orders[index].order;
    terms(&next, environment.selected, &order_terms, slot, old.filled)?;
    require!(
        order_terms.side == old.side
            && order_terms.reduce_only == old.reduce_only
            && order_terms.generation == old.generation
            && order_terms.fee_budget >= old.fee_charged,
        ClearingError::OrderTerms
    );
    if old.group_id > 0 {
        require!(
            order_terms.trigger == old.trigger && order_terms.lots <= old.original_lots,
            ClearingError::OrderTerms
        );
        let protection = &mut next
            .book
            .protections
            .iter_mut()
            .find(|entry| entry.protection.id == old.group_id)
            .ok_or(ClearingError::OrderState)?
            .protection;
        protection.version = protection
            .version
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
    }
    next.book.orders[index].delegate_epoch = delegate_epoch;
    next.book.orders[index].order = OrderRecord {
        version: old
            .version
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?,
        lots: order_terms.lots,
        limit: order_terms.limit,
        fee_budget: order_terms.fee_budget,
        start_slot: order_terms.start_slot,
        expiry_slot: order_terms.expiry_slot,
        trigger: order_terms.trigger,
        threshold: order_terms.threshold,
        ..old
    };
    finish(next, environment)
}

pub(crate) fn protect_with_environment(
    root: &MarginAccount,
    environment: &Environment,
    expected_id: u64,
    take_profit: OrderTerms,
    stop_loss: OrderTerms,
    delegate_epoch: u64,
) -> Result<MarginAccount> {
    environment.validate(root)?;
    let market = environment.market(environment.selected)?;
    let slot = environment.slot;
    require!(
        live_order_authority(root, delegate_epoch, slot),
        ClearingError::Authority
    );

    bound(root, market)?;
    validate(root)?;
    terms(root, environment.selected, &take_profit, slot, 0)?;
    terms(root, environment.selected, &stop_loss, slot, 0)?;
    let long = root.positions[environment.selected].lots > 0;
    require!(
        take_profit.reduce_only
            && stop_loss.reduce_only
            && take_profit.side == stop_loss.side
            && take_profit.lots == stop_loss.lots
            && take_profit.generation == stop_loss.generation
            && take_profit.start_slot == stop_loss.start_slot
            && take_profit.expiry_slot == stop_loss.expiry_slot
            && take_profit.trigger == if long { 1 } else { 2 }
            && stop_loss.trigger == if long { 2 } else { 1 }
            && if long {
                take_profit.threshold > market.reference_price
                    && stop_loss.threshold < market.reference_price
            } else {
                take_profit.threshold < market.reference_price
                    && stop_loss.threshold > market.reference_price
            },
        ClearingError::OrderTerms
    );
    let mut next = root.clone();
    refresh_with_environment(&mut next, environment)?;
    require!(
        next.book.last_order_id.checked_add(1) == Some(expected_id),
        ClearingError::OrderState
    );
    let index = next
        .book
        .protections
        .iter()
        .position(|entry| {
            entry.protection.id == 0
                || !next.book.orders.iter().any(|order| {
                    order.order.active() && order.order.group_id == entry.protection.id
                })
        })
        .ok_or(ClearingError::OrderSlots)?;
    next.book.last_group_id = next
        .book
        .last_group_id
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    let group_id = next.book.last_group_id;
    next.book.protections[index] = Protection {
        market_index: market.index,
        protection: ProtectiveGroup {
            id: group_id,
            version: 1,
            original: take_profit.lots,
            remaining: take_profit.lots,
            generation: take_profit.generation,
            side: take_profit.side,
        },
    };
    add(&mut next, market, take_profit, group_id, delegate_epoch)?;
    add(&mut next, market, stop_loss, group_id, delegate_epoch)?;
    finish(next, environment)
}

/// Cancel remains possible without an oracle. Survivors receive conservative reserves.
pub(crate) fn cancel_with_environment(
    root: &MarginAccount,
    environment: &Environment,
    id: u64,
    version: u64,
    protection_group: bool,
) -> Result<MarginAccount> {
    environment.validate(root)?;
    let market = environment.market(environment.selected)?;

    bound(root, market)?;
    validate(root)?;
    let mut next = root.clone();
    if protection_group {
        require!(
            id > 0
                && next
                    .book
                    .protections
                    .iter()
                    .any(|entry| entry.protection.id == id
                        && entry.protection.version == version
                        && usize::from(entry.market_index) == environment.selected),
            ClearingError::OrderState
        );
        let mut changed = false;
        for entry in &mut next.book.orders {
            if entry.order.active() && entry.order.group_id == id {
                entry.order.state = CANCELLED;
                changed = true;
            }
        }
        require!(changed, ClearingError::OrderState);
    } else {
        let index = find(&next, id, version)?;
        require!(
            usize::from(next.book.orders[index].market_index) == environment.selected,
            ClearingError::OrderState
        );
        next.book.orders[index].order.state = CANCELLED;
    }
    refresh_with_environment(&mut next, environment)?;
    advance(&mut next)?;
    Ok(next)
}

pub(crate) fn consume(
    root: &mut MarginAccount,
    index: usize,
    lots: u64,
    gross: u64,
    fee: u64,
) -> Result<()> {
    let order = &mut root.book.orders[index].order;
    order.filled = order
        .filled
        .checked_add(lots)
        .ok_or(ClearingError::Arithmetic)?;
    order.notional = checked(math::cash_add(order.notional, gross))?;
    order.fee_charged = checked(math::cash_add(order.fee_charged, fee))?;
    require!(
        order.filled <= order.lots && order.fee_charged <= order.fee_budget,
        ClearingError::OrderState
    );
    order.state = if order.filled == order.lots {
        FILLED
    } else {
        PARTIAL
    };
    if order.group_id > 0 {
        let protection = &mut root
            .book
            .protections
            .iter_mut()
            .find(|entry| entry.protection.id == order.group_id)
            .ok_or(ClearingError::OrderState)?
            .protection;
        protection.remaining = protection
            .remaining
            .checked_sub(lots)
            .ok_or(ClearingError::OrderState)?;
    }
    Ok(())
}

// Existing single-market entrypoints are thin adapters over the same book engine.
pub(crate) fn place(
    root: &MarginAccount,
    market: &Market,
    funding: i128,
    slot: u64,
    expected_id: u64,
    order_terms: OrderTerms,
) -> Result<MarginAccount> {
    place_with_environment(
        root,
        &Environment::isolated(market, funding, slot, true)?,
        expected_id,
        order_terms,
        0,
    )
}
pub(crate) fn replace(
    root: &MarginAccount,
    market: &Market,
    funding: i128,
    slot: u64,
    id: u64,
    version: u64,
    order_terms: OrderTerms,
) -> Result<MarginAccount> {
    replace_with_environment(
        root,
        &Environment::isolated(market, funding, slot, true)?,
        id,
        version,
        order_terms,
        0,
    )
}
pub(crate) fn protect(
    root: &MarginAccount,
    market: &Market,
    funding: i128,
    slot: u64,
    expected_id: u64,
    take_profit: OrderTerms,
    stop_loss: OrderTerms,
) -> Result<MarginAccount> {
    protect_with_environment(
        root,
        &Environment::isolated(market, funding, slot, true)?,
        expected_id,
        take_profit,
        stop_loss,
        0,
    )
}
pub(crate) fn cancel(
    root: &MarginAccount,
    market: &Market,
    slot: u64,
    id: u64,
    version: u64,
    protection_group: bool,
    credible: bool,
) -> Result<MarginAccount> {
    cancel_with_environment(
        root,
        &Environment::isolated(market, 0, slot, credible)?,
        id,
        version,
        protection_group,
    )
}

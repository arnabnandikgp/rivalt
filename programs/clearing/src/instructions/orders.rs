//! Wallet-owned persistent authority, bounded reservations and shared protection.

use crate::error::ClearingError;
use crate::events::OrderChanged;
use crate::instructions::{custody, oracle, routes};
use crate::state::{
    MarketState, LegacyOrderBook, Participant, ProtectiveGroup, OrderRecord, TestRouteState,
};

pub use crate::constants::orders::*;

use anchor_lang::prelude::*;

use financial_core as math;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct OrderTerms {
    pub side: u8,
    pub lots: u64,
    pub limit: u64,
    pub fee_budget: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub trigger: u8,
    pub threshold: u64,
    pub reduce_only: bool,
    pub generation: u64,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ManageOrder<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()],
        bump = participant.bump,
        has_one = owner,
        has_one = market,
    )]
    pub participant: Box<Account<'info, Participant>>,
    #[account(
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Box<Account<'info, TestRouteState>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CancelOrder<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()],
        bump = participant.bump,
        has_one = owner,
        has_one = market,
    )]
    pub participant: Box<Account<'info, Participant>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CleanupOrders<'info> {
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"participant", market.key().as_ref(), participant.owner.as_ref()],
        bump = participant.bump,
        has_one = market,
    )]
    pub participant: Box<Account<'info, Participant>>,
}

fn checked<T>(result: math::Result<T>) -> Result<T> {
    result.map_err(|_| error!(ClearingError::Arithmetic))
}

fn profile(market: &MarketState) -> Result<()> {
    require!(
        crate::financial_profile() && market.mode == 2,
        ClearingError::Profile
    );
    custody::profile(market)
}

pub fn validate(participant: &Participant) -> Result<()> {
    let book = &participant.book;
    let mut sum = 0u64;
    for (slot_index, order) in book.orders.iter().enumerate() {
        require!(
            order.state <= INVALIDATED && order.id <= book.last_order_id,
            ClearingError::OrderState
        );
        if order.active() {
            require!(
                order.id > 0
                    && order.version > 0
                    && participant.order_ids[slot_index] == order.id
                    && order.filled < order.lots
                    && order.lots <= routes::MAX_ROUTE_LOTS
                    && order.fee_charged == checked(math::fee_total(order.notional))?
                    && order.fee_charged <= order.fee_budget,
                ClearingError::OrderState
            );
            require!(
                !book.orders[..slot_index]
                    .iter()
                    .any(|other_order| other_order.active() && other_order.id == order.id),
                ClearingError::OrderState
            );
            if order.group_id > 0 {
                let group = book
                    .groups
                    .iter()
                    .find(|group| group.id == order.group_id)
                    .ok_or(ClearingError::OrderState)?;
                require!(
                    order.reduce_only
                        && group.id <= book.last_group_id
                        && group.generation == order.generation
                        && group.side == order.side
                        && group.remaining <= group.original,
                    ClearingError::OrderState
                );
            }
            sum = checked(math::cash_add(sum, order.reserve))?;
        } else {
            require!(
                participant.order_ids[slot_index] == 0 && order.reserve == 0,
                ClearingError::OrderState
            );
        }
    }
    require!(sum == participant.reserved, ClearingError::OrderState);
    Ok(())
}

fn sync(participant: &mut Participant) -> Result<()> {
    participant.reserved = 0;
    for (slot_index, order) in participant.book.orders.iter_mut().enumerate() {
        if order.active() {
            participant.order_ids[slot_index] = order.id;
            participant.reserved = checked(math::cash_add(participant.reserved, order.reserve))?;
        } else {
            participant.order_ids[slot_index] = 0;
            order.reserve = 0;
        }
    }
    Ok(())
}

fn prune(book: &mut LegacyOrderBook, lots: i64, generation: u64, terms: u64, slot: u64) {
    for order in &mut book.orders {
        if !order.active() {
            continue;
        }
        if slot >= order.expiry_slot {
            order.state = EXPIRED;
        } else if order.terms_epoch != terms
            || (order.reduce_only
                && (order.generation != generation
                    || lots == 0
                    || ((order.side == 0) != (lots < 0))))
        {
            order.state = INVALIDATED;
        } else if order.group_id > 0
            && book
                .groups
                .iter()
                .find(|group| group.id == order.group_id)
                .is_none_or(|group| group.remaining == 0)
        {
            order.state = INVALIDATED;
        }
        if !order.active() {
            order.reserve = 0;
        }
    }
}

pub fn eligible(book: &LegacyOrderBook, order: &OrderRecord, lots: i64) -> Result<u64> {
    let mut remaining_lots = order
        .lots
        .checked_sub(order.filled)
        .ok_or(ClearingError::OrderState)?;
    if order.reduce_only {
        remaining_lots = remaining_lots.min(lots.unsigned_abs());
    }
    if order.group_id > 0 {
        remaining_lots = remaining_lots.min(
            book.groups
                .iter()
                .find(|group| group.id == order.group_id)
                .ok_or(ClearingError::OrderState)?
                .remaining,
        );
    }
    Ok(remaining_lots)
}

/// Does not mutate readonly accounts; funding and previews use the same bound.
fn reserve_bounds(market: &MarketState, route_state: &TestRouteState) -> (u64, u64) {
    if oracle::action(market, route_state, false).is_ok() {
        (route_state.lower, route_state.upper)
    } else {
        (1, math::MAX_PRICE)
    }
}

pub fn required_at(
    participant: &Participant,
    terms_epoch: u64,
    lower: u64,
    upper: u64,
    slot: u64,
) -> Result<u64> {
    let mut book = participant.book;
    prune(
        &mut book,
        participant.lots,
        participant.generation,
        terms_epoch,
        slot,
    );
    let mut sum = 0;
    for order in &book.orders {
        if order.active() {
            sum = checked(math::cash_add(
                sum,
                checked(math::orders::reserve(
                    eligible(&book, order, participant.lots)?,
                    order.limit,
                    order.fee_budget - order.fee_charged,
                    order.side,
                    order.reduce_only,
                    lower,
                    upper,
                ))?,
            ))?;
        }
    }
    Ok(sum)
}

pub fn refresh(
    participant: &mut Participant,
    market: &MarketState,
    route_state: &TestRouteState,
) -> Result<()> {
    let (lower, upper) = reserve_bounds(market, route_state);
    let slot = Clock::get()?.slot;
    prune(
        &mut participant.book,
        participant.lots,
        participant.generation,
        market.terms_epoch,
        slot,
    );
    for slot_index in 0..4 {
        let order = participant.book.orders[slot_index];
        if order.active() {
            participant.book.orders[slot_index].reserve = checked(math::orders::reserve(
                eligible(&participant.book, &order, participant.lots)?,
                order.limit,
                order.fee_budget - order.fee_charged,
                order.side,
                order.reduce_only,
                lower,
                upper,
            ))?;
        }
    }
    participant.book.reserve_observation = route_state.observation_sequence;
    sync(participant)
}

fn terms(
    order_terms: &OrderTerms,
    participant: &Participant,
    slot: u64,
    filled: u64,
) -> Result<()> {
    require!(
        order_terms.side <= 1
            && order_terms.lots > filled
            && order_terms.lots <= routes::MAX_ROUTE_LOTS
            && (9_000..=110_000).contains(&order_terms.limit)
            && order_terms.fee_budget <= 1_000_000
            && order_terms.expiry_slot > slot
            && order_terms.expiry_slot > order_terms.start_slot
            && order_terms.expiry_slot - order_terms.start_slot <= MAX_ORDER_SLOTS
            && order_terms.expiry_slot - slot <= MAX_ORDER_SLOTS
            && order_terms.trigger <= 2
            && ((order_terms.trigger == 0 && order_terms.threshold == 0)
                || (order_terms.trigger > 0
                    && (10_000..=100_000).contains(&order_terms.threshold))),
        ClearingError::OrderTerms
    );
    if order_terms.reduce_only {
        require!(
            participant.lots != 0
                && order_terms.lots - filled <= participant.lots.unsigned_abs()
                && order_terms.generation == participant.generation
                && ((order_terms.side == 0) == (participant.lots < 0)),
            ClearingError::OrderTerms
        );
    } else {
        require!(order_terms.generation == 0, ClearingError::OrderTerms);
    }
    Ok(())
}

fn add(
    participant: &mut Participant,
    market: &MarketState,
    order_terms: OrderTerms,
    group_id: u64,
) -> Result<u64> {
    let index = participant
        .book
        .orders
        .iter()
        .position(|order| !order.active())
        .ok_or(ClearingError::OrderSlots)?;
    participant.book.last_order_id = participant
        .book
        .last_order_id
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    let id = participant.book.last_order_id;
    participant.book.orders[index] = OrderRecord {
        id,
        version: 1,
        state: OPEN,
        side: order_terms.side,
        original_lots: order_terms.lots,
        lots: order_terms.lots,
        fee_budget: order_terms.fee_budget,
        limit: order_terms.limit,
        start_slot: order_terms.start_slot,
        expiry_slot: order_terms.expiry_slot,
        trigger: order_terms.trigger,
        threshold: order_terms.threshold,
        reduce_only: order_terms.reduce_only,
        generation: order_terms.generation,
        group_id,
        terms_epoch: market.terms_epoch,
        ..OrderRecord::default()
    };
    sync(participant)?;
    Ok(id)
}

fn event(
    market: &mut Account<MarketState>,
    participant: &Account<Participant>,
    kind: u8,
    id: u64,
) -> Result<OrderChanged> {
    market.sequence = market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(OrderChanged {
        version: 1,
        domain: market.domain,
        market: market.key(),
        sequence: market.sequence,
        slot: Clock::get()?.slot,
        kind,
        participant: participant.key(),
        order_id: id,
        reserved: participant.reserved,
        order_ids: participant.order_ids,
        book: participant.book,
    })
}

fn admission(
    market: &MarketState,
    participant: &mut Participant,
    route_state: &TestRouteState,
) -> Result<()> {
    refresh(participant, market, route_state)?;
    checked(routes::participant_model(participant)?.admissible(
        route_state.lower,
        route_state.upper,
        oracle::effective(market, route_state)?,
    ))
}

pub fn place(ctx: Context<ManageOrder>, expected_id: u64, order_terms: OrderTerms) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    profile(&accounts.market)?;
    require!(!accounts.market.paused, ClearingError::Paused);
    validate(&accounts.participant)?;
    oracle::action(
        &accounts.market,
        &accounts.route_state,
        !order_terms.reduce_only,
    )?;
    terms(&order_terms, &accounts.participant, Clock::get()?.slot, 0)?;
    refresh(
        &mut accounts.participant,
        &accounts.market,
        &accounts.route_state,
    )?;
    require!(
        accounts.participant.book.last_order_id.checked_add(1) == Some(expected_id),
        ClearingError::OrderState
    );
    let id = add(&mut accounts.participant, &accounts.market, order_terms, 0)?;
    admission(
        &accounts.market,
        &mut accounts.participant,
        &accounts.route_state,
    )?;
    let event = event(&mut accounts.market, &accounts.participant, 0, id)?;
    emit_cpi!(event);
    Ok(())
}

pub fn replace(
    ctx: Context<ManageOrder>,
    id: u64,
    version: u64,
    order_terms: OrderTerms,
) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    profile(&accounts.market)?;
    require!(!accounts.market.paused, ClearingError::Paused);
    validate(&accounts.participant)?;
    oracle::action(
        &accounts.market,
        &accounts.route_state,
        !order_terms.reduce_only,
    )?;
    refresh(
        &mut accounts.participant,
        &accounts.market,
        &accounts.route_state,
    )?;
    let index = find(&accounts.participant, id, version)?;
    let old = accounts.participant.book.orders[index];
    terms(
        &order_terms,
        &accounts.participant,
        Clock::get()?.slot,
        old.filled,
    )?;
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
        let group = accounts
            .participant
            .book
            .groups
            .iter_mut()
            .find(|group| group.id == old.group_id)
            .ok_or(ClearingError::OrderState)?;
        group.version = group
            .version
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
    }
    accounts.participant.book.orders[index] = OrderRecord {
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
    admission(
        &accounts.market,
        &mut accounts.participant,
        &accounts.route_state,
    )?;
    let event = event(&mut accounts.market, &accounts.participant, 1, id)?;
    emit_cpi!(event);
    Ok(())
}

pub fn find(participant: &Participant, id: u64, version: u64) -> Result<usize> {
    participant
        .book
        .orders
        .iter()
        .position(|order| order.id == id && order.version == version && order.active())
        .ok_or_else(|| error!(ClearingError::OrderState))
}

pub fn cancel(ctx: Context<CancelOrder>, id: u64, version: u64) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    profile(&accounts.market)?;
    validate(&accounts.participant)?;
    let index = find(&accounts.participant, id, version)?;
    accounts.participant.book.orders[index].state = CANCELLED;
    sync(&mut accounts.participant)?;
    let event = event(&mut accounts.market, &accounts.participant, 2, id)?;
    emit_cpi!(event);
    Ok(())
}

pub fn protect(
    ctx: Context<ManageOrder>,
    expected_id: u64,
    tp: OrderTerms,
    sl: OrderTerms,
) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    profile(&accounts.market)?;
    require!(!accounts.market.paused, ClearingError::Paused);
    validate(&accounts.participant)?;
    oracle::action(&accounts.market, &accounts.route_state, false)?;
    let slot = Clock::get()?.slot;
    terms(&tp, &accounts.participant, slot, 0)?;
    terms(&sl, &accounts.participant, slot, 0)?;
    let long = accounts.participant.lots > 0;
    let reference = accounts.route_state.reference_price;
    require!(
        tp.reduce_only
            && sl.reduce_only
            && tp.side == sl.side
            && tp.lots == sl.lots
            && tp.lots <= accounts.participant.lots.unsigned_abs()
            && tp.generation == sl.generation
            && tp.start_slot == sl.start_slot
            && tp.expiry_slot == sl.expiry_slot
            && tp.trigger == (if long { 1 } else { 2 })
            && sl.trigger == (if long { 2 } else { 1 })
            && (if long {
                tp.threshold > reference && sl.threshold < reference
            } else {
                tp.threshold < reference && sl.threshold > reference
            }),
        ClearingError::OrderTerms
    );
    refresh(
        &mut accounts.participant,
        &accounts.market,
        &accounts.route_state,
    )?;
    require!(
        accounts.participant.book.last_order_id.checked_add(1) == Some(expected_id),
        ClearingError::OrderState
    );
    let index = accounts
        .participant
        .book
        .groups
        .iter()
        .position(|group| {
            group.id == 0
                || !accounts
                    .participant
                    .book
                    .orders
                    .iter()
                    .any(|order| order.active() && order.group_id == group.id)
        })
        .ok_or(ClearingError::OrderSlots)?;
    accounts.participant.book.last_group_id = accounts
        .participant
        .book
        .last_group_id
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    let group_id = accounts.participant.book.last_group_id;
    accounts.participant.book.groups[index] = ProtectiveGroup {
        id: group_id,
        version: 1,
        original: tp.lots,
        remaining: tp.lots,
        generation: tp.generation,
        side: tp.side,
    };
    add(&mut accounts.participant, &accounts.market, tp, group_id)?;
    add(&mut accounts.participant, &accounts.market, sl, group_id)?;
    admission(
        &accounts.market,
        &mut accounts.participant,
        &accounts.route_state,
    )?;
    let event = event(&mut accounts.market, &accounts.participant, 3, expected_id)?;
    emit_cpi!(event);
    Ok(())
}

pub fn cancel_group(ctx: Context<CancelOrder>, group_id: u64, version: u64) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    profile(&accounts.market)?;
    validate(&accounts.participant)?;
    require!(
        group_id > 0
            && accounts
                .participant
                .book
                .groups
                .iter()
                .any(|group| group.id == group_id && group.version == version),
        ClearingError::OrderState
    );
    let mut changed = false;
    for order in &mut accounts.participant.book.orders {
        if order.active() && order.group_id == group_id {
            order.state = CANCELLED;
            changed = true;
        }
    }
    require!(changed, ClearingError::OrderState);
    sync(&mut accounts.participant)?;
    let event = event(&mut accounts.market, &accounts.participant, 4, group_id)?;
    emit_cpi!(event);
    Ok(())
}

pub fn cleanup(ctx: Context<CleanupOrders>) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    profile(&accounts.market)?;
    validate(&accounts.participant)?;
    let ids = accounts.participant.order_ids;
    let lots = accounts.participant.lots;
    let generation = accounts.participant.generation;
    prune(
        &mut accounts.participant.book,
        lots,
        generation,
        accounts.market.terms_epoch,
        Clock::get()?.slot,
    );
    sync(&mut accounts.participant)?;
    require!(
        accounts.participant.order_ids != ids,
        ClearingError::OrderState
    );
    let event = event(&mut accounts.market, &accounts.participant, 5, 0)?;
    emit_cpi!(event);
    Ok(())
}

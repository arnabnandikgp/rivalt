//! Wallet-owned persistent authority, bounded reservations and shared protection.
use crate::{custody, oracle, routes, ClearingError, MarketState, Participant, TestRouteState};
use anchor_lang::prelude::*;
use financial_core as math;

pub const OPEN: u8 = 1;
pub const PARTIAL: u8 = 2;
pub const FILLED: u8 = 3;
pub const CANCELLED: u8 = 4;
pub const EXPIRED: u8 = 5;
pub const INVALIDATED: u8 = 6;
pub const MAX_ORDER_SLOTS: u64 = 216_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct StoredOrder {
    pub id: u64,
    pub version: u64,
    pub state: u8,
    pub side: u8,
    pub original_lots: u64,
    pub lots: u64,
    pub filled: u64,
    pub notional: u64,
    pub fee_charged: u64,
    pub fee_budget: u64,
    pub limit: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    /// 0 none, 1 central reference >= threshold, 2 <= threshold.
    pub trigger: u8,
    pub threshold: u64,
    pub reduce_only: bool,
    pub generation: u64,
    pub group_id: u64,
    pub terms_epoch: u64,
    pub reserve: u64,
}
impl StoredOrder {
    pub fn active(&self) -> bool {
        self.state == OPEN || self.state == PARTIAL
    }
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct ProtectiveGroup {
    pub id: u64,
    pub version: u64,
    pub original: u64,
    pub remaining: u64,
    pub generation: u64,
    pub side: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct OrderBook {
    pub last_order_id: u64,
    pub last_group_id: u64,
    pub reserve_observation: u64,
    pub orders: [StoredOrder; 4],
    pub groups: [ProtectiveGroup; 2],
}
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
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),owner.key().as_ref()],bump=participant.bump,has_one=owner,has_one=market)]
    pub participant: Box<Account<'info, Participant>>,
    #[account(seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct CancelOrder<'info> {
    pub owner: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),owner.key().as_ref()],bump=participant.bump,has_one=owner,has_one=market)]
    pub participant: Box<Account<'info, Participant>>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct CleanupOrders<'info> {
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),participant.owner.as_ref()],bump=participant.bump,has_one=market)]
    pub participant: Box<Account<'info, Participant>>,
}
#[event]
pub struct OrderChanged {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    /// 0 place, 1 replace, 2 cancel, 3 protective pair, 4 cancel group, 5 cleanup.
    pub kind: u8,
    pub participant: Pubkey,
    pub order_id: u64,
    pub reserved: u64,
    pub order_ids: [u64; 4],
    pub book: OrderBook,
}
fn checked<T>(r: math::Result<T>) -> Result<T> {
    r.map_err(|_| error!(ClearingError::Arithmetic))
}
fn profile(m: &MarketState) -> Result<()> {
    require!(
        cfg!(feature = "local-test-profile") && m.mode == 2,
        ClearingError::Profile
    );
    custody::profile(m)
}
pub fn validate(p: &Participant) -> Result<()> {
    let b = &p.book;
    let mut sum = 0u64;
    for (i, o) in b.orders.iter().enumerate() {
        require!(
            o.state <= INVALIDATED && o.id <= b.last_order_id,
            ClearingError::OrderState
        );
        if o.active() {
            require!(
                o.id > 0
                    && o.version > 0
                    && p.order_ids[i] == o.id
                    && o.filled < o.lots
                    && o.lots <= routes::MAX_ROUTE_LOTS
                    && o.fee_charged == checked(math::fee_total(o.notional))?
                    && o.fee_charged <= o.fee_budget,
                ClearingError::OrderState
            );
            require!(
                !b.orders[..i].iter().any(|x| x.active() && x.id == o.id),
                ClearingError::OrderState
            );
            if o.group_id > 0 {
                let g = b
                    .groups
                    .iter()
                    .find(|g| g.id == o.group_id)
                    .ok_or(ClearingError::OrderState)?;
                require!(
                    o.reduce_only
                        && g.id <= b.last_group_id
                        && g.generation == o.generation
                        && g.side == o.side
                        && g.remaining <= g.original,
                    ClearingError::OrderState
                );
            }
            sum = checked(math::cash_add(sum, o.reserve))?;
        } else {
            require!(
                p.order_ids[i] == 0 && o.reserve == 0,
                ClearingError::OrderState
            );
        }
    }
    require!(sum == p.reserved, ClearingError::OrderState);
    Ok(())
}
fn sync(p: &mut Participant) -> Result<()> {
    p.reserved = 0;
    for (i, o) in p.book.orders.iter_mut().enumerate() {
        if o.active() {
            p.order_ids[i] = o.id;
            p.reserved = checked(math::cash_add(p.reserved, o.reserve))?;
        } else {
            p.order_ids[i] = 0;
            o.reserve = 0;
        }
    }
    Ok(())
}
fn prune(book: &mut OrderBook, lots: i64, generation: u64, terms: u64, slot: u64) {
    for o in &mut book.orders {
        if !o.active() {
            continue;
        }
        if slot >= o.expiry_slot {
            o.state = EXPIRED;
        } else if o.terms_epoch != terms
            || (o.reduce_only
                && (o.generation != generation || lots == 0 || ((o.side == 0) != (lots < 0))))
        {
            o.state = INVALIDATED;
        } else if o.group_id > 0
            && book
                .groups
                .iter()
                .find(|g| g.id == o.group_id)
                .is_none_or(|g| g.remaining == 0)
        {
            o.state = INVALIDATED;
        }
        if !o.active() {
            o.reserve = 0;
        }
    }
}
pub fn eligible(book: &OrderBook, o: &StoredOrder, lots: i64) -> Result<u64> {
    let mut n = o
        .lots
        .checked_sub(o.filled)
        .ok_or(ClearingError::OrderState)?;
    if o.reduce_only {
        n = n.min(lots.unsigned_abs());
    }
    if o.group_id > 0 {
        n = n.min(
            book.groups
                .iter()
                .find(|g| g.id == o.group_id)
                .ok_or(ClearingError::OrderState)?
                .remaining,
        );
    }
    Ok(n)
}
/// Does not mutate readonly accounts; funding and previews use the same bound.
fn reserve_bounds(m: &MarketState, r: &TestRouteState) -> (u64, u64) {
    if oracle::action(m, r, false).is_ok() {
        (r.lower, r.upper)
    } else {
        (1, math::MAX_PRICE)
    }
}
pub fn required_at(
    p: &Participant,
    terms_epoch: u64,
    lower: u64,
    upper: u64,
    slot: u64,
) -> Result<u64> {
    let mut book = p.book;
    prune(&mut book, p.lots, p.generation, terms_epoch, slot);
    let mut sum = 0;
    for o in &book.orders {
        if o.active() {
            sum = checked(math::cash_add(
                sum,
                checked(math::orders::reserve(
                    eligible(&book, o, p.lots)?,
                    o.limit,
                    o.fee_budget - o.fee_charged,
                    o.side,
                    o.reduce_only,
                    lower,
                    upper,
                ))?,
            ))?;
        }
    }
    Ok(sum)
}
pub fn refresh(p: &mut Participant, m: &MarketState, r: &TestRouteState) -> Result<()> {
    let (lower, upper) = reserve_bounds(m, r);
    let slot = Clock::get()?.slot;
    prune(&mut p.book, p.lots, p.generation, m.terms_epoch, slot);
    for i in 0..4 {
        let o = p.book.orders[i];
        if o.active() {
            p.book.orders[i].reserve = checked(math::orders::reserve(
                eligible(&p.book, &o, p.lots)?,
                o.limit,
                o.fee_budget - o.fee_charged,
                o.side,
                o.reduce_only,
                lower,
                upper,
            ))?;
        }
    }
    p.book.reserve_observation = r.observation_sequence;
    sync(p)
}
fn terms(t: &OrderTerms, p: &Participant, slot: u64, filled: u64) -> Result<()> {
    require!(
        t.side <= 1
            && t.lots > filled
            && t.lots <= routes::MAX_ROUTE_LOTS
            && (9_000..=110_000).contains(&t.limit)
            && t.fee_budget <= 1_000_000
            && t.expiry_slot > slot
            && t.expiry_slot > t.start_slot
            && t.expiry_slot - t.start_slot <= MAX_ORDER_SLOTS
            && t.expiry_slot - slot <= MAX_ORDER_SLOTS
            && t.trigger <= 2
            && ((t.trigger == 0 && t.threshold == 0)
                || (t.trigger > 0 && (10_000..=100_000).contains(&t.threshold))),
        ClearingError::OrderTerms
    );
    if t.reduce_only {
        require!(
            p.lots != 0
                && t.lots - filled <= p.lots.unsigned_abs()
                && t.generation == p.generation
                && ((t.side == 0) == (p.lots < 0)),
            ClearingError::OrderTerms
        );
    } else {
        require!(t.generation == 0, ClearingError::OrderTerms);
    }
    Ok(())
}
fn add(p: &mut Participant, m: &MarketState, t: OrderTerms, group_id: u64) -> Result<u64> {
    let index = p
        .book
        .orders
        .iter()
        .position(|o| !o.active())
        .ok_or(ClearingError::OrderSlots)?;
    p.book.last_order_id = p
        .book
        .last_order_id
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    let id = p.book.last_order_id;
    p.book.orders[index] = StoredOrder {
        id,
        version: 1,
        state: OPEN,
        side: t.side,
        original_lots: t.lots,
        lots: t.lots,
        fee_budget: t.fee_budget,
        limit: t.limit,
        start_slot: t.start_slot,
        expiry_slot: t.expiry_slot,
        trigger: t.trigger,
        threshold: t.threshold,
        reduce_only: t.reduce_only,
        generation: t.generation,
        group_id,
        terms_epoch: m.terms_epoch,
        ..StoredOrder::default()
    };
    sync(p)?;
    Ok(id)
}
fn event(
    m: &mut Account<MarketState>,
    p: &Account<Participant>,
    kind: u8,
    id: u64,
) -> Result<OrderChanged> {
    m.sequence = m.sequence.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    Ok(OrderChanged {
        version: 1,
        domain: m.domain,
        market: m.key(),
        sequence: m.sequence,
        slot: Clock::get()?.slot,
        kind,
        participant: p.key(),
        order_id: id,
        reserved: p.reserved,
        order_ids: p.order_ids,
        book: p.book,
    })
}
fn admission(m: &MarketState, p: &mut Participant, r: &TestRouteState) -> Result<()> {
    refresh(p, m, r)?;
    checked(routes::participant_model(p)?.admissible(r.lower, r.upper, oracle::effective(m, r)?))
}
pub fn place(ctx: Context<ManageOrder>, expected_id: u64, t: OrderTerms) -> Result<()> {
    let a = &mut *ctx.accounts;
    profile(&a.market)?;
    require!(!a.market.paused, ClearingError::Paused);
    validate(&a.participant)?;
    oracle::action(&a.market, &a.route_state, !t.reduce_only)?;
    terms(&t, &a.participant, Clock::get()?.slot, 0)?;
    refresh(&mut a.participant, &a.market, &a.route_state)?;
    require!(
        a.participant.book.last_order_id.checked_add(1) == Some(expected_id),
        ClearingError::OrderState
    );
    let id = add(&mut a.participant, &a.market, t, 0)?;
    admission(&a.market, &mut a.participant, &a.route_state)?;
    let ev = event(&mut a.market, &a.participant, 0, id)?;
    emit_cpi!(ev);
    Ok(())
}
pub fn replace(ctx: Context<ManageOrder>, id: u64, version: u64, t: OrderTerms) -> Result<()> {
    let a = &mut *ctx.accounts;
    profile(&a.market)?;
    require!(!a.market.paused, ClearingError::Paused);
    validate(&a.participant)?;
    oracle::action(&a.market, &a.route_state, !t.reduce_only)?;
    refresh(&mut a.participant, &a.market, &a.route_state)?;
    let index = find(&a.participant, id, version)?;
    let old = a.participant.book.orders[index];
    terms(&t, &a.participant, Clock::get()?.slot, old.filled)?;
    require!(
        t.side == old.side
            && t.reduce_only == old.reduce_only
            && t.generation == old.generation
            && t.fee_budget >= old.fee_charged,
        ClearingError::OrderTerms
    );
    if old.group_id > 0 {
        require!(
            t.trigger == old.trigger && t.lots <= old.original_lots,
            ClearingError::OrderTerms
        );
        let g = a
            .participant
            .book
            .groups
            .iter_mut()
            .find(|g| g.id == old.group_id)
            .ok_or(ClearingError::OrderState)?;
        g.version = g.version.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    }
    a.participant.book.orders[index] = StoredOrder {
        version: old
            .version
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?,
        lots: t.lots,
        limit: t.limit,
        fee_budget: t.fee_budget,
        start_slot: t.start_slot,
        expiry_slot: t.expiry_slot,
        trigger: t.trigger,
        threshold: t.threshold,
        ..old
    };
    admission(&a.market, &mut a.participant, &a.route_state)?;
    let ev = event(&mut a.market, &a.participant, 1, id)?;
    emit_cpi!(ev);
    Ok(())
}
pub fn find(p: &Participant, id: u64, version: u64) -> Result<usize> {
    p.book
        .orders
        .iter()
        .position(|o| o.id == id && o.version == version && o.active())
        .ok_or_else(|| error!(ClearingError::OrderState))
}
pub fn cancel(ctx: Context<CancelOrder>, id: u64, version: u64) -> Result<()> {
    let a = &mut *ctx.accounts;
    profile(&a.market)?;
    validate(&a.participant)?;
    let index = find(&a.participant, id, version)?;
    a.participant.book.orders[index].state = CANCELLED;
    sync(&mut a.participant)?;
    let ev = event(&mut a.market, &a.participant, 2, id)?;
    emit_cpi!(ev);
    Ok(())
}
pub fn protect(
    ctx: Context<ManageOrder>,
    expected_id: u64,
    tp: OrderTerms,
    sl: OrderTerms,
) -> Result<()> {
    let a = &mut *ctx.accounts;
    profile(&a.market)?;
    require!(!a.market.paused, ClearingError::Paused);
    validate(&a.participant)?;
    oracle::action(&a.market, &a.route_state, false)?;
    let slot = Clock::get()?.slot;
    terms(&tp, &a.participant, slot, 0)?;
    terms(&sl, &a.participant, slot, 0)?;
    let long = a.participant.lots > 0;
    let reference = a.route_state.reference_price;
    require!(
        tp.reduce_only
            && sl.reduce_only
            && tp.side == sl.side
            && tp.lots == sl.lots
            && tp.lots <= a.participant.lots.unsigned_abs()
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
    refresh(&mut a.participant, &a.market, &a.route_state)?;
    require!(
        a.participant.book.last_order_id.checked_add(1) == Some(expected_id),
        ClearingError::OrderState
    );
    let index = a
        .participant
        .book
        .groups
        .iter()
        .position(|g| {
            g.id == 0
                || !a
                    .participant
                    .book
                    .orders
                    .iter()
                    .any(|o| o.active() && o.group_id == g.id)
        })
        .ok_or(ClearingError::OrderSlots)?;
    a.participant.book.last_group_id = a
        .participant
        .book
        .last_group_id
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    let group_id = a.participant.book.last_group_id;
    a.participant.book.groups[index] = ProtectiveGroup {
        id: group_id,
        version: 1,
        original: tp.lots,
        remaining: tp.lots,
        generation: tp.generation,
        side: tp.side,
    };
    add(&mut a.participant, &a.market, tp, group_id)?;
    add(&mut a.participant, &a.market, sl, group_id)?;
    admission(&a.market, &mut a.participant, &a.route_state)?;
    let ev = event(&mut a.market, &a.participant, 3, expected_id)?;
    emit_cpi!(ev);
    Ok(())
}
pub fn cancel_group(ctx: Context<CancelOrder>, group_id: u64, version: u64) -> Result<()> {
    let a = &mut *ctx.accounts;
    profile(&a.market)?;
    validate(&a.participant)?;
    require!(
        group_id > 0
            && a.participant
                .book
                .groups
                .iter()
                .any(|g| g.id == group_id && g.version == version),
        ClearingError::OrderState
    );
    let mut changed = false;
    for o in &mut a.participant.book.orders {
        if o.active() && o.group_id == group_id {
            o.state = CANCELLED;
            changed = true;
        }
    }
    require!(changed, ClearingError::OrderState);
    sync(&mut a.participant)?;
    let ev = event(&mut a.market, &a.participant, 4, group_id)?;
    emit_cpi!(ev);
    Ok(())
}
pub fn cleanup(ctx: Context<CleanupOrders>) -> Result<()> {
    let a = &mut *ctx.accounts;
    profile(&a.market)?;
    validate(&a.participant)?;
    let ids = a.participant.order_ids;
    let lots = a.participant.lots;
    let generation = a.participant.generation;
    prune(
        &mut a.participant.book,
        lots,
        generation,
        a.market.terms_epoch,
        Clock::get()?.slot,
    );
    sync(&mut a.participant)?;
    require!(a.participant.order_ids != ids, ClearingError::OrderState);
    let ev = event(&mut a.market, &a.participant, 5, 0)?;
    emit_cpi!(ev);
    Ok(())
}

//! Bounded, read-only maker quote contract. Quotes confer no clearing authority.
use anchor_lang::prelude::*;
use financial_core::{MAX_CASH, MAX_LOTS, MAX_PRICE};

pub const VERSION: u16 = 1;
pub const GROUP_VERSION: u16 = 2;
pub const ACCOUNT_VERSION: u16 = 3;
pub const MIN_EPOCH_SLOTS: u64 = 64;
pub const MAX_EPOCH_SLOTS: u64 = 3_600;
pub const RESPONSE_BYTES: usize = 92;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub struct MakerState {
    pub version: u16,
    pub maker_id: u8,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub capital: Pubkey,
    pub domain: [u8; 32],
    pub quote_epoch: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct QuoteRequest {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub capital: Pubkey,
    pub quote_epoch: u64,
    pub authority_epoch: u64,
    pub terms_epoch: u64,
    pub market_config_epoch: u64,
    /// Taker side: 0 buys from the maker; 1 sells to it.
    pub side: u8,
    pub lots: u64,
    pub inventory: i64,
    pub cash: u64,
    pub inventory_limit: u64,
    pub consumed: u64,
    /// Indicative quote input, never an authenticated risk observation.
    pub reference_price: u64,
    pub slot: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct QuoteResponse {
    pub version: u16,
    pub maker_id: u8,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub remaining: u64,
    pub quote_epoch: u64,
    pub authority_epoch: u64,
    pub terms_epoch: u64,
    pub market_config_epoch: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub consumed_before: u64,
    pub reference_price: u64,
}

/// Separate V2 contract binds the group as well as market and isolated capital.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct GroupQuoteRequest {
    pub group: Pubkey,
    pub quote: QuoteRequest,
}

pub fn group_quote(
    group: Pubkey,
    state: &MakerState,
    request: &GroupQuoteRequest,
) -> QuoteResult<QuoteResponse> {
    scoped_quote(group, request.group, state, &request.quote, GROUP_VERSION)
}

/// Schema-3 venue binding is a separate envelope; the reference curve is shared.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AccountQuoteRequest {
    pub venue: Pubkey,
    pub quote: QuoteRequest,
}

pub fn account_quote(
    venue: Pubkey,
    state: &MakerState,
    request: &AccountQuoteRequest,
) -> QuoteResult<QuoteResponse> {
    scoped_quote(venue, request.venue, state, &request.quote, ACCOUNT_VERSION)
}

fn scoped_quote(
    domain_key: Pubkey,
    request_key: Pubkey,
    state: &MakerState,
    request: &QuoteRequest,
    version: u16,
) -> QuoteResult<QuoteResponse> {
    if domain_key == Pubkey::default()
        || request_key != domain_key
        || state.version != version
        || request.version != version
    {
        return Err(QuoteError::Binding);
    }
    // Strategy arithmetic is identical. Only the authenticated envelope changes.
    let mut strategy_state = state.clone();
    let mut strategy_request = request.clone();
    strategy_state.version = VERSION;
    strategy_request.version = VERSION;
    let mut response = quote(&strategy_state, &strategy_request)?;
    response.version = version;
    Ok(response)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuoteError {
    Binding,
    Lifetime,
    Bounds,
    Capacity,
    Arithmetic,
    Producer,
    Response,
}
type QuoteResult<T> = core::result::Result<T, QuoteError>;

/// Fixed strategy version 1: A has tight/shallow pricing and stronger inventory skew.
pub fn strategy(id: u8) -> QuoteResult<(u64, u64, u64, i64, i64)> {
    match id {
        0 => Ok((512, 10, 0, 64, 4)),
        1 => Ok((4_096, 30, 256, 256, 1)),
        _ => Err(QuoteError::Binding),
    }
}

/// Sum of marginal price offsets at consumed indices 0..n. Integral ticks, no floats.
fn impact(n: u64, flat: u64) -> QuoteResult<i128> {
    let rising = i128::from(n.saturating_sub(flat));
    rising
        .checked_mul(rising.saturating_sub(1))
        .map(|v| v / 2)
        .ok_or(QuoteError::Arithmetic)
}

pub fn quote(state: &MakerState, req: &QuoteRequest) -> QuoteResult<QuoteResponse> {
    if state.version != VERSION
        || req.version != VERSION
        || state.domain != req.domain
        || state.market != req.market
        || state.capital != req.capital
        || state.quote_epoch != req.quote_epoch
        || state.quote_epoch == 0
        || req.authority_epoch == 0
        || req.terms_epoch == 0
        || req.market_config_epoch == 0
    {
        return Err(QuoteError::Binding);
    }
    let duration = state
        .expiry_slot
        .checked_sub(state.start_slot)
        .ok_or(QuoteError::Lifetime)?;
    if !(MIN_EPOCH_SLOTS..=MAX_EPOCH_SLOTS).contains(&duration)
        || req.slot < state.start_slot
        || req.slot >= state.expiry_slot
    {
        return Err(QuoteError::Lifetime);
    }
    if req.side > 1
        || req.lots == 0
        || !(1..=MAX_PRICE).contains(&req.reference_price)
        || req.cash > MAX_CASH
        || req.inventory_limit == 0
        || req.inventory_limit > MAX_LOTS as u64
        || req.inventory.unsigned_abs() > req.inventory_limit
    {
        return Err(QuoteError::Bounds);
    }
    let (depth, spread, flat, skew_step, skew_tick) = strategy(state.maker_id)?;
    let remaining_curve = depth
        .checked_sub(req.consumed)
        .ok_or(QuoteError::Capacity)?;
    let directional = if req.side == 0 {
        i128::from(req.inventory_limit) + i128::from(req.inventory)
    } else {
        i128::from(req.inventory_limit) - i128::from(req.inventory)
    };
    // A quote availability cap only. P04 must independently check actual post-fill risk.
    let funded =
        (u128::from(req.cash) * 10 / u128::from(req.reference_price)).min(MAX_LOTS as u128) as u64;
    let capacity = remaining_curve
        .min(directional as u64)
        .min(funded.saturating_sub(req.inventory.unsigned_abs()));
    if req.lots > capacity {
        return Err(QuoteError::Capacity);
    }
    let end = req
        .consumed
        .checked_add(req.lots)
        .ok_or(QuoteError::Arithmetic)?;
    let center =
        i128::from(req.reference_price) - i128::from(req.inventory / skew_step * skew_tick);
    let sign = if req.side == 0 { 1 } else { -1 };
    let base = center + sign * i128::from(spread);
    let first = base + sign * i128::from(req.consumed.saturating_sub(flat));
    let last = base + sign * i128::from((end - 1).saturating_sub(flat));
    if first.min(last) < 1 || first.max(last) > i128::from(MAX_PRICE) {
        return Err(QuoteError::Bounds);
    }
    let gross = base
        .checked_mul(i128::from(req.lots))
        .and_then(|x| {
            x.checked_add(sign * (impact(end, flat).ok()? - impact(req.consumed, flat).ok()?))
        })
        .ok_or(QuoteError::Arithmetic)?;
    let gross_quote = u64::try_from(gross).map_err(|_| QuoteError::Arithmetic)?;
    if gross_quote == 0 || gross_quote > MAX_CASH {
        return Err(QuoteError::Bounds);
    }
    Ok(QuoteResponse {
        version: VERSION,
        maker_id: state.maker_id,
        side: req.side,
        lots: req.lots,
        gross_quote,
        remaining: capacity - req.lots,
        quote_epoch: state.quote_epoch,
        authority_epoch: req.authority_epoch,
        terms_epoch: req.terms_epoch,
        market_config_epoch: req.market_config_epoch,
        start_slot: state.start_slot,
        expiry_slot: state.expiry_slot,
        consumed_before: req.consumed,
        reference_price: req.reference_price,
    })
}

/// Clearing rejects a foreign producer, noncanonical response, or changed authorized terms.
pub fn validate_response(
    expected_program: &Pubkey,
    producer: &Pubkey,
    bytes: &[u8],
    expected: &QuoteResponse,
) -> QuoteResult<QuoteResponse> {
    if expected_program != producer {
        return Err(QuoteError::Producer);
    }
    if bytes.len() != RESPONSE_BYTES {
        return Err(QuoteError::Response);
    }
    let response = QuoteResponse::try_from_slice(bytes).map_err(|_| QuoteError::Response)?;
    if &response != expected {
        return Err(QuoteError::Response);
    }
    Ok(response)
}

/// Pure transition used by route execution in P04; no standalone consuming instruction.
pub fn consume(consumed: u64, response: &QuoteResponse) -> QuoteResult<u64> {
    if consumed != response.consumed_before || response.lots == 0 {
        return Err(QuoteError::Response);
    }
    consumed
        .checked_add(response.lots)
        .ok_or(QuoteError::Arithmetic)
}

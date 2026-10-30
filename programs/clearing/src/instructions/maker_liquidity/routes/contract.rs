use super::*;
use crate::instructions::account_trading::authority::AccountGuard;

/// D70 signs structural authority, never a price sequence or consumption prefix.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityRouteLeg {
    pub lots: u64,
    pub authority_epoch: u64,
    pub control_epoch: u64,
    pub shape_epoch: u64,
    pub depth_epoch: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityRouteIntent {
    pub guard: AccountGuard,
    pub domain: [u8; 32],
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub side: u8,
    pub lots: u64,
    pub all_in_limit: u64,
    pub max_fee: u64,
    pub reduce_only: bool,
    pub generation: Option<u64>,
    pub legs: Vec<LiquidityRouteLeg>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityOrderExecution {
    pub guard: AccountGuard,
    pub id: u64,
    pub version: u64,
    pub filled: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub lots: u64,
    pub legs: Vec<LiquidityRouteLeg>,
}

pub(super) fn shared_legs(legs: &[LiquidityRouteLeg]) -> Vec<RouteLeg> {
    legs.iter()
        .map(|leg| RouteLeg {
            lots: leg.lots,
            quote_epoch: leg.control_epoch,
            authority_epoch: leg.authority_epoch,
        })
        .collect()
}

pub(super) fn validate_leg(
    leg: &LiquidityRouteLeg,
    registration: &MakerRegistration,
    curve: &CurveState,
) -> Result<()> {
    require!(
        leg.lots > 0
            && leg.lots <= canonical::MAX_DEPTH
            && leg.authority_epoch == registration.authority_epoch
            && leg.control_epoch == curve.control_epoch
            && leg.shape_epoch == curve.shape_epoch
            && leg.depth_epoch == registration.depth_epoch,
        ClearingError::MakerEpoch
    );
    Ok(())
}

/// Normalize an already authenticated, independently checked CPI result into the
/// shared financial engine's scalar quote envelope. No legacy maker is invoked.
pub(super) fn financial_quote(
    quote: &canonical::MakerQuoteResponse,
    market: &Market,
    clock: &Clock,
) -> crate::engine::routes::ExecutionQuote {
    crate::engine::routes::ExecutionQuote {
        version: 4,
        maker_id: quote.request.instance,
        side: quote.request.side,
        lots: quote.request.lots,
        gross_quote: quote.gross,
        remaining: quote.remaining,
        quote_epoch: quote.request.control_epoch,
        authority_epoch: quote.request.authority_epoch,
        terms_epoch: market.terms_epoch,
        market_config_epoch: market.config_epoch,
        start_slot: clock.slot,
        expiry_slot: quote.valid_until_slot,
        consumed_before: quote.request.consumed,
        reference_price: market.reference_price,
    }
}

pub(super) fn consume(
    registration: &mut MakerRegistration,
    quote: &canonical::MakerQuoteResponse,
) -> Result<()> {
    require!(
        quote.request.instance == registration.instance && quote.request.side <= 1,
        ClearingError::MakerResponse
    );
    let consumed = if quote.request.side == 0 {
        &mut registration.buy_consumed
    } else {
        &mut registration.sell_consumed
    };
    require!(
        *consumed == quote.request.consumed,
        ClearingError::MakerEpoch
    );
    let next = consumed
        .checked_add(quote.request.lots)
        .ok_or(ClearingError::Arithmetic)?;
    require!(next <= canonical::MAX_DEPTH, ClearingError::MakerResponse);
    *consumed = next;
    Ok(())
}

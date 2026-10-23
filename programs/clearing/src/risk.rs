//! G10 funded receiver liquidation. Complete-cohort resolution lives separately.
use crate::{
    custody, oracle, orders, routes, ClearingError, MarketState, Participant, TestRouteState,
};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use financial_core as math;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RiskParticipant {
    pub participant: Pubkey,
    pub id: u16,
    pub cash: u64,
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
    pub nonce: u64,
    pub reserved: u64,
    pub order_ids: [u64; 4],
    pub book: orders::OrderBook,
}
#[inline(never)]
pub fn snapshot(p: &Account<Participant>) -> RiskParticipant {
    participant_snapshot(p.key(), p)
}
#[inline(never)]
pub fn participant_snapshot(key: Pubkey, p: &Participant) -> RiskParticipant {
    RiskParticipant {
        participant: key,
        id: p.id,
        cash: p.cash,
        lots: p.lots,
        virtual_scaled: p.virtual_scaled,
        funding_checkpoint_scaled: p.funding_checkpoint_scaled,
        generation: p.generation,
        nonce: p.nonce,
        reserved: p.reserved,
        order_ids: p.order_ids,
        book: p.book,
    }
}
#[event_cpi]
#[derive(Accounts)]
pub struct Liquidate<'info> {
    pub receiver_owner: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),target.owner.as_ref()],bump=target.bump,has_one=market)]
    pub target: Box<Account<'info, Participant>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),receiver_owner.key().as_ref()],bump=receiver.bump,has_one=market,
        constraint=receiver.owner==receiver_owner.key() @ ClearingError::Authority)]
    pub receiver: Box<Account<'info, Participant>>,
    /// CHECK: canonical binding PDA must be uninitialized/system-owned. A dust
    /// transfer cannot disqualify it; an initialized maker binding always does.
    #[account(seeds=[b"maker-capital",receiver.key().as_ref()],bump)]
    pub receiver_binding: UncheckedAccount<'info>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        constraint=vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint=vault.owner==market.key() @ ClearingError::Authority)]
    pub vault: Box<Account<'info, TokenAccount>>,
}
#[event]
pub struct LiquidationApplied {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub slot: u64,
    pub observation: u64,
    pub lots: u64,
    pub price: u64,
    pub fee: u64,
    pub deficit_before: i128,
    pub deficit_after: i128,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub gross_lots: u64,
    pub target: RiskParticipant,
    pub receiver: RiskParticipant,
}
fn checked<T>(r: math::Result<T>) -> Result<T> {
    r.map_err(|_| error!(ClearingError::Liquidation))
}
pub fn liquidate(
    ctx: Context<Liquidate>,
    sequence: u64,
    observation: u64,
    lots: u64,
    price: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        ClearingError::Liquidation
    );
    let a = &mut *ctx.accounts;
    let (fee, before, after) = apply_liquidation(a, sequence, observation, lots, price)?;
    let event = LiquidationApplied {
        version: 1,
        domain: a.market.domain,
        market: a.market.key(),
        terms_epoch: a.market.terms_epoch,
        config_epoch: a.market.config_epoch,
        sequence: a.market.sequence,
        slot: Clock::get()?.slot,
        observation,
        lots,
        price,
        fee,
        deficit_before: before,
        deficit_after: after,
        funding_index_scaled: a.market.funding_index_scaled,
        funding_time: a.market.funding_time,
        gross_lots: a.route_state.gross_lots,
        target: snapshot(&a.target),
        receiver: snapshot(&a.receiver),
    };
    emit_cpi!(event);
    Ok(())
}

#[inline(never)]
fn apply_liquidation(
    a: &mut Liquidate,
    sequence: u64,
    observation: u64,
    lots: u64,
    price: u64,
) -> Result<(u64, i128, i128)> {
    require!(
        crate::financial_profile() && a.market.mode == 2,
        ClearingError::Profile
    );
    custody::profile(&a.market)?;
    require!(!a.market.paused, ClearingError::Paused);
    require!(
        a.market.sequence == sequence && a.route_state.observation_sequence == observation,
        ClearingError::FinancialSequence
    );
    require_keys_neq!(a.target.key(), a.receiver.key(), ClearingError::Alias);
    require!(
        a.receiver_binding.owner == &anchor_lang::system_program::ID
            && a.receiver_binding.data_is_empty()
            && a.receiver.cash > 0,
        ClearingError::Liquidation
    );
    custody::reconciled(&a.market, a.vault.amount)?;
    oracle::action(&a.market, &a.route_state, false)?;
    oracle::materialize(&mut a.market, &a.route_state)?;
    let target = routes::participant_model(&a.target)?;
    let receiver = routes::participant_model(&a.receiver)?;
    let before = checked(math::liquidation::deficit(
        &target,
        a.route_state.lower,
        a.route_state.upper,
        a.market.funding_index_scaled,
    ))?;
    let (next, received, fee) = checked(math::liquidation::candidate(
        target,
        receiver,
        lots,
        price,
        a.route_state.reference_price,
        a.route_state.lower,
        a.route_state.upper,
        a.market.funding_index_scaled,
    ))?;
    let gross = a
        .route_state
        .gross_lots
        .checked_sub(target.lots.unsigned_abs() + receiver.lots.unsigned_abs())
        .and_then(|n| n.checked_add(next.lots.unsigned_abs() + received.lots.unsigned_abs()))
        .ok_or(ClearingError::Arithmetic)?;
    require!(gross <= math::MAX_GROSS_LOTS, ClearingError::Liquidation);
    // A real distressed transfer has passed strict post-fee progress. Only then
    // may conflicting risk-increasing authority be invalidated atomically.
    for o in &mut a.target.book.orders {
        if o.active() && !o.reduce_only {
            o.state = orders::INVALIDATED;
            o.reserve = 0;
        }
    }
    routes::commit(&mut a.target, next);
    routes::commit(&mut a.receiver, received);
    orders::refresh(&mut a.target, &a.market, &a.route_state)?;
    orders::refresh(&mut a.receiver, &a.market, &a.route_state)?;
    let after = checked(math::liquidation::deficit(
        &routes::participant_model(&a.target)?,
        a.route_state.lower,
        a.route_state.upper,
        a.market.funding_index_scaled,
    ))?;
    checked(routes::participant_model(&a.receiver)?.admissible(
        a.route_state.lower,
        a.route_state.upper,
        a.market.funding_index_scaled,
    ))?;
    require!(after < before, ClearingError::Liquidation);
    a.route_state.gross_lots = gross;
    a.market.sequence = a
        .market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok((fee, before, after))
}

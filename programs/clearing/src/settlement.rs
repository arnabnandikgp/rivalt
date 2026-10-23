//! Ordinary collection/settlement and exits in the expiring synthetic profile.
//! A complete, sequence-bound cohort check prevents paying a selected winner
//! while another participant cannot cover its conservatively valued loss.
use crate::{
    custody, routes, ClearingError, MarketState, Participant, ParticipantRegistry, TestRouteState,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use financial_core as math;

#[account]
#[derive(InitSpace)]
pub struct ExitGuard {
    pub market: Pubkey,
    pub sequence: u64,
    pub observation: u64,
    pub count: u16,
    pub next: u16,
    pub cash: u64,
    pub lots: i128,
    pub exposed: u64,
    pub unpaid: i128,
    pub bump: u8,
}
#[derive(Accounts)]
pub struct InitializeExitGuard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(init,payer=payer,space=8+ExitGuard::INIT_SPACE,seeds=[b"exit-guard",market.key().as_ref()],bump)]
    pub guard: Account<'info, ExitGuard>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CheckExitCohort<'info> {
    #[account(seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"registry",market.key().as_ref()],bump=registry.bump,has_one=market)]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(mut,seeds=[b"exit-guard",market.key().as_ref()],bump=guard.bump,has_one=market)]
    pub guard: Account<'info, ExitGuard>,
    #[account(seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        constraint=vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint=vault.owner==market.key() @ ClearingError::Authority)]
    pub vault: Box<Account<'info, TokenAccount>>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct LedgerChange<'info> {
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),participant.owner.as_ref()],bump=participant.bump,has_one=market)]
    pub participant: Box<Account<'info, Participant>>,
    #[account(seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"exit-guard",market.key().as_ref()],bump=guard.bump,has_one=market)]
    pub guard: Account<'info, ExitGuard>,
    #[account(seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        constraint=vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint=vault.owner==market.key() @ ClearingError::Authority)]
    pub vault: Box<Account<'info, TokenAccount>>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawTrading<'info> {
    pub owner: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=quote_mint,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),owner.key().as_ref()],bump=participant.bump,has_one=market,has_one=owner)]
    pub participant: Box<Account<'info, Participant>>,
    #[account(seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"exit-guard",market.key().as_ref()],bump=guard.bump,has_one=market)]
    pub guard: Box<Account<'info, ExitGuard>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut,seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        token::mint=quote_mint,token::authority=market)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut,constraint=user_token.key()!=vault.key() @ ClearingError::Alias,
        token::mint=quote_mint,token::authority=owner)]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}
#[event]
pub struct SettlementChanged {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub observation: u64,
    /// 0 collect loss, 1 settle gain, 2 withdraw funded cash.
    pub kind: u8,
    pub participant: Pubkey,
    pub amount: u64,
    pub participant_cash: u64,
    pub participant_virtual: i128,
    pub participant_reserved: u64,
    pub participant_order_ids: [u64; 4],
    pub participant_book: crate::orders::OrderBook,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub total_cash: u64,
    pub settlement: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
}
fn checked<T>(r: math::Result<T>) -> Result<T> {
    r.map_err(|_| error!(ClearingError::Arithmetic))
}
fn live(m: &MarketState, r: &TestRouteState, sequence: u64, observation: u64) -> Result<bool> {
    require!(crate::financial_profile(), ClearingError::Profile);
    custody::profile(m)?;
    require!(m.mode == 1 || m.mode == 2, ClearingError::Profile);
    require!(!m.paused, ClearingError::Paused);
    require!(m.sequence == sequence, ClearingError::FinancialSequence);
    require!(
        observation == r.observation_sequence,
        ClearingError::RiskObservation
    );
    let credible = crate::oracle::action(m, r, false).is_ok();
    require!(credible || m.mode == 2, ClearingError::RiskObservation);
    Ok(credible)
}
fn certified(g: &ExitGuard, sequence: u64, observation: u64) -> Result<()> {
    require!(
        g.sequence == sequence && g.observation == observation && g.next == g.count && g.count > 0,
        ClearingError::ExitCohort
    );
    Ok(())
}
pub fn initialize(ctx: Context<InitializeExitGuard>) -> Result<()> {
    require!(crate::financial_profile(), ClearingError::Profile);
    ctx.accounts.guard.market = ctx.accounts.market.key();
    ctx.accounts.guard.bump = ctx.bumps.guard;
    Ok(())
}
pub fn check(
    ctx: Context<CheckExitCohort>,
    sequence: u64,
    observation: u64,
    start: u16,
) -> Result<()> {
    let a = &mut *ctx.accounts;
    let credible = live(&a.market, &a.route_state, sequence, observation)?;
    custody::reconciled(&a.market, a.vault.amount)?;
    let registry = &a.registry;
    require!(
        registry.schema_version == 1
            && usize::from(registry.count) == registry.members.len()
            && registry.count <= 64,
        ClearingError::ExitCohort
    );
    let g = &mut a.guard;
    if start == 0 {
        // A permissionless caller may begin a new snapshot, but cannot rewind
        // useful progress (or revoke a completed certificate) at the same stamp.
        require!(
            g.sequence != sequence
                || g.observation != observation
                || g.count != registry.count
                || g.next == 0,
            ClearingError::ExitCohort
        );
        g.sequence = sequence;
        g.observation = observation;
        g.count = registry.count;
        g.next = 0;
        g.cash = 0;
        g.lots = 0;
        g.exposed = 0;
        g.unpaid = 0;
    }
    require!(
        g.sequence == sequence
            && g.observation == observation
            && g.count == registry.count
            && g.next == start,
        ClearingError::ExitCohort
    );
    let n = ctx.remaining_accounts.len();
    require!(
        (1..=8).contains(&n) && usize::from(start) + n <= usize::from(g.count),
        ClearingError::ExitCohort
    );
    for (offset, info) in ctx.remaining_accounts.iter().enumerate() {
        let id = usize::from(start) + offset;
        require!(
            !info.is_writable && info.owner == &crate::ID && info.key == &registry.members[id],
            ClearingError::ExitCohort
        );
        let p = Participant::try_deserialize(&mut &info.try_borrow_data()?[..])?;
        require!(
            p.market == a.market.key() && usize::from(p.id) == id,
            ClearingError::ExitCohort
        );
        let key = Pubkey::create_program_address(
            &[
                b"participant",
                a.market.key().as_ref(),
                p.owner.as_ref(),
                &[p.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| error!(ClearingError::ExitCohort))?;
        require_keys_eq!(key, *info.key, ClearingError::ExitCohort);
        let model = routes::participant_model(&p)?;
        require!(credible || p.lots == 0, ClearingError::ExitCohort);
        for funding in crate::oracle::funding_bounds(&a.market, &a.route_state)? {
            require!(
                checked(model.risk_equity(
                    a.route_state.lower.max(1),
                    a.route_state.upper.max(1),
                    funding
                ))? >= 0,
                ClearingError::ExitCohort
            );
        }
        g.exposed = g
            .exposed
            .checked_add(p.lots.unsigned_abs())
            .ok_or(ClearingError::Arithmetic)?;
        g.cash = checked(math::cash_add(g.cash, p.cash))?;
        g.lots = g
            .lots
            .checked_add(i128::from(p.lots))
            .ok_or(ClearingError::Arithmetic)?;
        g.unpaid = g
            .unpaid
            .checked_add(checked(model.unpaid(a.route_state.reference_price, 0))?)
            .ok_or(ClearingError::Arithmetic)?;
    }
    g.next = g
        .next
        .checked_add(n as u16)
        .ok_or(ClearingError::Arithmetic)?;
    if g.next == g.count {
        require!(
            g.cash == a.market.total_cash
                && g.lots == 0
                && g.unpaid == i128::from(a.market.settlement) * math::SCALE,
            ClearingError::Reconciliation
        );
    }
    Ok(())
}
fn commit(p: &mut Participant, model: math::Participant) {
    p.cash = model.cash;
    p.virtual_scaled = model.virtual_scaled;
    p.funding_checkpoint_scaled = model.funding_checkpoint;
}
fn event(
    m: &mut Account<MarketState>,
    p: &Account<Participant>,
    observation: u64,
    kind: u8,
    amount: u64,
    actual: u64,
) -> Result<SettlementChanged> {
    m.sequence = m.sequence.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    Ok(SettlementChanged {
        version: 1,
        domain: m.domain,
        market: m.key(),
        sequence: m.sequence,
        slot: Clock::get()?.slot,
        observation,
        kind,
        participant: p.key(),
        amount,
        participant_cash: p.cash,
        participant_virtual: p.virtual_scaled,
        participant_reserved: p.reserved,
        participant_order_ids: p.order_ids,
        participant_book: p.book,
        funding_index_scaled: m.funding_index_scaled,
        funding_time: m.funding_time,
        total_cash: m.total_cash,
        settlement: m.settlement,
        allocated_vault: m.allocated_vault,
        actual_vault: actual,
    })
}
pub fn change(
    ctx: Context<LedgerChange>,
    sequence: u64,
    observation: u64,
    amount: u64,
    gain: bool,
) -> Result<()> {
    let a = &mut *ctx.accounts;
    let credible = live(&a.market, &a.route_state, sequence, observation)?;
    custody::reconciled(&a.market, a.vault.amount)?;
    if gain {
        certified(&a.guard, sequence, observation)?;
        require!(credible || a.guard.exposed == 0, ClearingError::ExitCohort);
    }
    require!(
        credible || a.participant.lots == 0,
        ClearingError::RiskObservation
    );
    crate::oracle::materialize(&mut a.market, &a.route_state)?;
    crate::orders::refresh(&mut a.participant, &a.market, &a.route_state)?;
    let mut p = routes::participant_model(&a.participant)?;
    let mut pools = math::Pools {
        vault: a.market.allocated_vault,
        settlement: a.market.settlement,
        insurance: a.market.insurance,
        fees: a.market.fees,
    };
    if gain {
        (p, pools) = checked(math::settle(
            p,
            pools,
            amount,
            a.route_state.reference_price,
            a.market.funding_index_scaled,
        ))?;
        checked(p.admissible(
            a.route_state.lower.max(1),
            a.route_state.upper.max(1),
            a.market.funding_index_scaled,
        ))?;
        a.market.total_cash = checked(math::cash_add(a.market.total_cash, amount))?;
    } else {
        (p, pools) = checked(math::collect(
            p,
            pools,
            amount,
            a.route_state.reference_price,
            a.market.funding_index_scaled,
        ))?;
        a.market.total_cash = checked(math::cash_sub(a.market.total_cash, amount))?;
    }
    commit(&mut a.participant, p);
    a.market.settlement = pools.settlement;
    custody::reconciled(&a.market, a.vault.amount)?;
    let ev = event(
        &mut a.market,
        &a.participant,
        observation,
        u8::from(gain),
        amount,
        a.vault.amount,
    )?;
    emit_cpi!(ev);
    Ok(())
}
pub fn withdraw(
    ctx: Context<WithdrawTrading>,
    sequence: u64,
    observation: u64,
    amount: u64,
) -> Result<()> {
    let a = &mut *ctx.accounts;
    let credible = live(&a.market, &a.route_state, sequence, observation)?;
    certified(&a.guard, sequence, observation)?;
    require!(credible || a.guard.exposed == 0, ClearingError::ExitCohort);
    crate::oracle::materialize(&mut a.market, &a.route_state)?;
    custody::reconciled(&a.market, a.vault.amount)?;
    crate::orders::refresh(&mut a.participant, &a.market, &a.route_state)?;
    let p = routes::participant_model(&a.participant)?;
    let p = checked(p.withdraw(
        amount,
        a.route_state.lower.max(1),
        a.route_state.upper.max(1),
        a.market.funding_index_scaled,
    ))?;
    let bump = [a.market.bump];
    let seeds: &[&[u8]] = &[b"market", b"BTC", &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.vault.to_account_info(),
                mint: a.quote_mint.to_account_info(),
                to: a.user_token.to_account_info(),
                authority: a.market.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        custody::DECIMALS,
    )?;
    commit(&mut a.participant, p);
    a.market.total_cash = checked(math::cash_sub(a.market.total_cash, amount))?;
    a.market.allocated_vault = checked(math::cash_sub(a.market.allocated_vault, amount))?;
    a.vault.reload()?;
    custody::reconciled(&a.market, a.vault.amount)?;
    let ev = event(
        &mut a.market,
        &a.participant,
        observation,
        2,
        amount,
        a.vault.amount,
    )?;
    emit_cpi!(ev);
    Ok(())
}

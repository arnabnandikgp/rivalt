//! Ordinary collection/settlement and exits in the expiring synthetic profile.
//! A complete, sequence-bound cohort check prevents paying a selected winner
//! while another participant cannot cover its conservatively valued loss.

use crate::error::ClearingError;
use crate::events::SettlementChanged;
use crate::instructions::{custody, routes};
use crate::state::{ExitGuard, MarketState, Participant, ParticipantRegistry, TestRouteState};

use anchor_lang::prelude::*;

use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use financial_core as math;

#[derive(Accounts)]
pub struct InitializeExitGuard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        init,
        payer = payer,
        space = 8 + ExitGuard::INIT_SPACE,
        seeds = [b"exit-guard", market.key().as_ref()],
        bump,
    )]
    pub guard: Account<'info, ExitGuard>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckExitCohort<'info> {
    #[account(
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(
        seeds = [b"registry", market.key().as_ref()],
        bump = registry.bump,
        has_one = market,
    )]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(
        mut,
        seeds = [b"exit-guard", market.key().as_ref()],
        bump = guard.bump,
        has_one = market,
    )]
    pub guard: Account<'info, ExitGuard>,
    #[account(
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        constraint = vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint = vault.owner==market.key() @ ClearingError::Authority,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct LedgerChange<'info> {
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"participant", market.key().as_ref(), participant.owner.as_ref()],
        bump = participant.bump,
        has_one = market,
    )]
    pub participant: Box<Account<'info, Participant>>,
    #[account(
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(
        seeds = [b"exit-guard", market.key().as_ref()],
        bump = guard.bump,
        has_one = market,
    )]
    pub guard: Account<'info, ExitGuard>,
    #[account(
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        constraint = vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint = vault.owner==market.key() @ ClearingError::Authority,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawTrading<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = quote_mint,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()],
        bump = participant.bump,
        has_one = market,
        has_one = owner,
    )]
    pub participant: Box<Account<'info, Participant>>,
    #[account(
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(
        seeds = [b"exit-guard", market.key().as_ref()],
        bump = guard.bump,
        has_one = market,
    )]
    pub guard: Box<Account<'info, ExitGuard>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = quote_mint,
        token::authority = market,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = user_token.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint,
        token::authority = owner,
    )]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

fn checked<T>(result: math::Result<T>) -> Result<T> {
    result.map_err(|_| error!(ClearingError::Arithmetic))
}

fn live(
    market: &MarketState,
    route_state: &TestRouteState,
    sequence: u64,
    observation: u64,
) -> Result<bool> {
    require!(crate::financial_profile(), ClearingError::Profile);
    custody::profile(market)?;
    require!(market.mode == 1 || market.mode == 2, ClearingError::Profile);
    require!(!market.paused, ClearingError::Paused);
    require!(
        market.sequence == sequence,
        ClearingError::FinancialSequence
    );
    require!(
        observation == route_state.observation_sequence,
        ClearingError::RiskObservation
    );
    let credible = crate::oracle::action(market, route_state, false).is_ok();
    require!(credible || market.mode == 2, ClearingError::RiskObservation);
    Ok(credible)
}

fn certified(guard: &ExitGuard, sequence: u64, observation: u64) -> Result<()> {
    require!(
        guard.sequence == sequence
            && guard.observation == observation
            && guard.next == guard.count
            && guard.count > 0,
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
    let accounts = &mut *ctx.accounts;
    let credible = live(
        &accounts.market,
        &accounts.route_state,
        sequence,
        observation,
    )?;
    custody::reconciled(&accounts.market, accounts.vault.amount)?;
    let registry = &accounts.registry;
    require!(
        registry.schema_version == 1
            && usize::from(registry.count) == registry.members.len()
            && registry.count <= 64,
        ClearingError::ExitCohort
    );
    let guard = &mut accounts.guard;
    if start == 0 {
        // A permissionless caller may begin a new snapshot, but cannot rewind
        // useful progress (or revoke a completed certificate) at the same stamp.
        require!(
            guard.sequence != sequence
                || guard.observation != observation
                || guard.count != registry.count
                || guard.next == 0,
            ClearingError::ExitCohort
        );
        guard.sequence = sequence;
        guard.observation = observation;
        guard.count = registry.count;
        guard.next = 0;
        guard.cash = 0;
        guard.lots = 0;
        guard.exposed = 0;
        guard.unpaid = 0;
    }
    require!(
        guard.sequence == sequence
            && guard.observation == observation
            && guard.count == registry.count
            && guard.next == start,
        ClearingError::ExitCohort
    );
    let page_len = ctx.remaining_accounts.len();
    require!(
        (1..=8).contains(&page_len) && usize::from(start) + page_len <= usize::from(guard.count),
        ClearingError::ExitCohort
    );
    for (offset, info) in ctx.remaining_accounts.iter().enumerate() {
        let id = usize::from(start) + offset;
        require!(
            !info.is_writable && info.owner == &crate::ID && info.key == &registry.members[id],
            ClearingError::ExitCohort
        );
        let participant = Participant::try_deserialize(&mut &info.try_borrow_data()?[..])?;
        require!(
            participant.market == accounts.market.key() && usize::from(participant.id) == id,
            ClearingError::ExitCohort
        );
        let key = Pubkey::create_program_address(
            &[
                b"participant",
                accounts.market.key().as_ref(),
                participant.owner.as_ref(),
                &[participant.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| error!(ClearingError::ExitCohort))?;
        require_keys_eq!(key, *info.key, ClearingError::ExitCohort);
        let model = routes::participant_model(&participant)?;
        require!(credible || participant.lots == 0, ClearingError::ExitCohort);
        for funding in crate::oracle::funding_bounds(&accounts.market, &accounts.route_state)? {
            require!(
                checked(model.risk_equity(
                    accounts.route_state.lower.max(1),
                    accounts.route_state.upper.max(1),
                    funding
                ))? >= 0,
                ClearingError::ExitCohort
            );
        }
        guard.exposed = guard
            .exposed
            .checked_add(participant.lots.unsigned_abs())
            .ok_or(ClearingError::Arithmetic)?;
        guard.cash = checked(math::cash_add(guard.cash, participant.cash))?;
        guard.lots = guard
            .lots
            .checked_add(i128::from(participant.lots))
            .ok_or(ClearingError::Arithmetic)?;
        guard.unpaid = guard
            .unpaid
            .checked_add(checked(
                model.unpaid(accounts.route_state.reference_price, 0),
            )?)
            .ok_or(ClearingError::Arithmetic)?;
    }
    guard.next = guard
        .next
        .checked_add(page_len as u16)
        .ok_or(ClearingError::Arithmetic)?;
    if guard.next == guard.count {
        require!(
            guard.cash == accounts.market.total_cash
                && guard.lots == 0
                && guard.unpaid == i128::from(accounts.market.settlement) * math::SCALE,
            ClearingError::Reconciliation
        );
    }
    Ok(())
}

fn commit(participant: &mut Participant, model: math::Participant) {
    participant.cash = model.cash;
    participant.virtual_scaled = model.virtual_scaled;
    participant.funding_checkpoint_scaled = model.funding_checkpoint;
}

fn event(
    market: &mut Account<MarketState>,
    participant: &Account<Participant>,
    observation: u64,
    kind: u8,
    amount: u64,
    actual: u64,
) -> Result<SettlementChanged> {
    market.sequence = market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(SettlementChanged {
        version: 1,
        domain: market.domain,
        market: market.key(),
        sequence: market.sequence,
        slot: Clock::get()?.slot,
        observation,
        kind,
        participant: participant.key(),
        amount,
        participant_cash: participant.cash,
        participant_virtual: participant.virtual_scaled,
        participant_reserved: participant.reserved,
        participant_order_ids: participant.order_ids,
        participant_book: participant.book,
        funding_index_scaled: market.funding_index_scaled,
        funding_time: market.funding_time,
        total_cash: market.total_cash,
        settlement: market.settlement,
        allocated_vault: market.allocated_vault,
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
    let accounts = &mut *ctx.accounts;
    let credible = live(
        &accounts.market,
        &accounts.route_state,
        sequence,
        observation,
    )?;
    custody::reconciled(&accounts.market, accounts.vault.amount)?;
    if gain {
        certified(&accounts.guard, sequence, observation)?;
        require!(
            credible || accounts.guard.exposed == 0,
            ClearingError::ExitCohort
        );
    }
    require!(
        credible || accounts.participant.lots == 0,
        ClearingError::RiskObservation
    );
    crate::oracle::materialize(&mut accounts.market, &accounts.route_state)?;
    crate::orders::refresh(
        &mut accounts.participant,
        &accounts.market,
        &accounts.route_state,
    )?;
    let mut participant = routes::participant_model(&accounts.participant)?;
    let mut pools = math::Pools {
        vault: accounts.market.allocated_vault,
        settlement: accounts.market.settlement,
        insurance: accounts.market.insurance,
        fees: accounts.market.fees,
    };
    if gain {
        (participant, pools) = checked(math::settle(
            participant,
            pools,
            amount,
            accounts.route_state.reference_price,
            accounts.market.funding_index_scaled,
        ))?;
        checked(participant.admissible(
            accounts.route_state.lower.max(1),
            accounts.route_state.upper.max(1),
            accounts.market.funding_index_scaled,
        ))?;
        accounts.market.total_cash = checked(math::cash_add(accounts.market.total_cash, amount))?;
    } else {
        (participant, pools) = checked(math::collect(
            participant,
            pools,
            amount,
            accounts.route_state.reference_price,
            accounts.market.funding_index_scaled,
        ))?;
        accounts.market.total_cash = checked(math::cash_sub(accounts.market.total_cash, amount))?;
    }
    commit(&mut accounts.participant, participant);
    accounts.market.settlement = pools.settlement;
    custody::reconciled(&accounts.market, accounts.vault.amount)?;
    let event = event(
        &mut accounts.market,
        &accounts.participant,
        observation,
        u8::from(gain),
        amount,
        accounts.vault.amount,
    )?;
    emit_cpi!(event);
    Ok(())
}

pub fn withdraw(
    ctx: Context<WithdrawTrading>,
    sequence: u64,
    observation: u64,
    amount: u64,
) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    let credible = live(
        &accounts.market,
        &accounts.route_state,
        sequence,
        observation,
    )?;
    certified(&accounts.guard, sequence, observation)?;
    require!(
        credible || accounts.guard.exposed == 0,
        ClearingError::ExitCohort
    );
    crate::oracle::materialize(&mut accounts.market, &accounts.route_state)?;
    custody::reconciled(&accounts.market, accounts.vault.amount)?;
    crate::orders::refresh(
        &mut accounts.participant,
        &accounts.market,
        &accounts.route_state,
    )?;
    let participant = routes::participant_model(&accounts.participant)?;
    let participant = checked(participant.withdraw(
        amount,
        accounts.route_state.lower.max(1),
        accounts.route_state.upper.max(1),
        accounts.market.funding_index_scaled,
    ))?;
    let bump = [accounts.market.bump];
    let seeds: &[&[u8]] = &[b"market", b"BTC", &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            accounts.token_program.key(),
            TransferChecked {
                from: accounts.vault.to_account_info(),
                mint: accounts.quote_mint.to_account_info(),
                to: accounts.user_token.to_account_info(),
                authority: accounts.market.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        custody::DECIMALS,
    )?;
    commit(&mut accounts.participant, participant);
    accounts.market.total_cash = checked(math::cash_sub(accounts.market.total_cash, amount))?;
    accounts.market.allocated_vault =
        checked(math::cash_sub(accounts.market.allocated_vault, amount))?;
    accounts.vault.reload()?;
    custody::reconciled(&accounts.market, accounts.vault.amount)?;
    let event = event(
        &mut accounts.market,
        &accounts.participant,
        observation,
        2,
        amount,
        accounts.vault.amount,
    )?;
    emit_cpi!(event);
    Ok(())
}

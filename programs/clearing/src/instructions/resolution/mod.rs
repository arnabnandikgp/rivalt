//! Frozen, exact-cohort resolution. Cash mutations and the planning ledger are
//! separate so even derived claims beyond the ordinary stored-v limit can close.

use crate::error::ClearingError;
use crate::events::{ResolutionParticipant, ResolutionProgress, ResolutionUpdate};
use crate::instructions::{custody, oracle, routes};
use crate::state::{
    MarketState, Participant, ParticipantRegistry, ResolutionHeader, LegacyResolutionRow,
    ResolutionState, TestRouteState,
};

pub use crate::constants::resolution::*;

use anchor_lang::prelude::*;

use anchor_spl::token::TokenAccount;

use financial_core::{self as math, oracle as policy};

use solana_sha256_hasher::hashv;

#[derive(Accounts)]
pub struct InitializeResolution<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        init,
        payer = authority,
        space = 8 + ResolutionState::INIT_SPACE,
        seeds = [b"resolution", market.key().as_ref()],
        bump,
    )]
    pub resolution: Box<Account<'info, ResolutionState>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct FreezeMarket<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        seeds = [b"participant", market.key().as_ref(), target.owner.as_ref()],
        bump = target.bump,
        has_one = market,
    )]
    pub target: Box<Account<'info, Participant>>,
    #[account(
        mut,
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
        seeds = [b"resolution", market.key().as_ref()],
        bump = resolution.bump,
        has_one = market,
    )]
    pub resolution: Box<Account<'info, ResolutionState>>,
    #[account(
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        constraint = vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint = vault.owner==market.key() @ ClearingError::Authority,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: exact immutable source binding/owner/schema validated by sources().
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub guard_collateral: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdvanceResolution<'info> {
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
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
        seeds = [b"resolution", market.key().as_ref()],
        bump = resolution.bump,
        has_one = market,
    )]
    pub resolution: Box<Account<'info, ResolutionState>>,
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
pub struct RecoverResolution<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
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
        seeds = [b"resolution", market.key().as_ref()],
        bump = resolution.bump,
        has_one = market,
    )]
    pub resolution: Box<Account<'info, ResolutionState>>,
    #[account(
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        constraint = vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint = vault.owner==market.key() @ ClearingError::Authority,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: exact immutable source binding/owner/schema validated by sources().
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub guard_collateral: UncheckedAccount<'info>,
}

fn checked<T>(result: math::Result<T>) -> Result<T> {
    result.map_err(|_| error!(ClearingError::Resolution))
}

fn next(value: u64) -> Result<u64> {
    value
        .checked_add(1)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}

fn registry_hash(registry: &ParticipantRegistry) -> Result<[u8; 32]> {
    require!(
        registry.schema_version == 1
            && registry.count > 0
            && registry.count <= 64
            && usize::from(registry.count) == registry.members.len(),
        ClearingError::Resolution
    );
    Ok(hashv(
        &registry
            .members
            .iter()
            .map(|member_key| member_key.as_ref())
            .collect::<Vec<_>>(),
    )
    .to_bytes())
}

fn sources(
    infos: [&AccountInfo; 4],
    observation: &mut crate::state::OracleState,
    now: i64,
) -> Result<Option<policy::Bounds>> {
    let mut values = [None; 4];
    for source_index in 0..4 {
        oracle::binding(
            infos[source_index],
            observation.sources[source_index],
            source_index,
        )?;
        if let Ok((source_price, sequence)) = oracle::source(
            infos[source_index],
            observation.sources[source_index],
            source_index,
            observation.source_sequences[source_index],
        ) {
            values[source_index] = Some(source_price);
            observation.source_sequences[source_index] = sequence;
        }
    }
    Ok(values[0]
        .zip(values[1])
        .and_then(|(source_price, collateral_price)| {
            oracle::source_bounds(
                [source_price, collateral_price],
                values[2]
                    .zip(values[3])
                    .map(|(source_price, collateral_price)| [source_price, collateral_price]),
                now,
            )
            .ok()
        }))
}

fn frozen(
    market: &MarketState,
    route_state: &TestRouteState,
    registry: &ParticipantRegistry,
    state: &ResolutionState,
    vault: u64,
    epoch: u64,
) -> Result<()> {
    require!(crate::financial_profile(), ClearingError::Profile);
    custody::profile(market)?;
    let header = &state.header;
    require!(
        market.mode == 3
            && market.paused
            && state.version == 1
            && header.epoch == epoch
            && header.stage >= AWAIT_VALUATION
            && header.stage <= COMPLETE
            && header.count == registry.count
            && header.registry_hash == registry_hash(registry)?
            && state.rows.len() == usize::from(header.count)
            && market.funding_index_scaled == header.funding
            && route_state.gross_lots == header.remaining_gross,
        ClearingError::Resolution
    );
    cash_invariant(market, header, vault)
}

fn cash_invariant(market: &MarketState, header: &ResolutionHeader, vault: u64) -> Result<()> {
    let insurance_transferred = if header.insurance_moved {
        header.insured_atoms
    } else {
        0
    };
    require!(
        market.total_cash
            == checked(math::cash_add(
                checked(math::cash_sub(header.initial_cash, header.collected_total))?,
                header.paid_applied
            ))?
            && market.settlement
                == checked(math::cash_sub(
                    checked(math::cash_add(
                        checked(math::cash_add(header.initial_pool, header.collected_total))?,
                        insurance_transferred
                    ))?,
                    header.paid_applied
                ))?
            && market.insurance
                == checked(math::cash_sub(
                    header.initial_insurance,
                    insurance_transferred
                ))?
            && market.fees == header.initial_fees
            && market.allocated_vault == header.initial_vault,
        ClearingError::Reconciliation
    );
    custody::reconciled(market, vault)
}

fn progress(
    market: &mut Account<MarketState>,
    route_state: &TestRouteState,
    state: &ResolutionState,
    kind: u8,
    rows: Vec<ResolutionUpdate>,
    participants: Vec<ResolutionParticipant>,
) -> Result<ResolutionProgress> {
    market.sequence = next(market.sequence)?;
    Ok(ResolutionProgress {
        version: 1,
        domain: market.domain,
        market: market.key(),
        terms_epoch: market.terms_epoch,
        config_epoch: market.config_epoch,
        sequence: market.sequence,
        slot: Clock::get()?.slot,
        kind,
        mode: market.mode,
        paused: market.paused,
        funding_index_scaled: market.funding_index_scaled,
        funding_time: market.funding_time,
        total_cash: market.total_cash,
        settlement: market.settlement,
        insurance: market.insurance,
        fees: market.fees,
        allocated_vault: market.allocated_vault,
        gross_lots: route_state.gross_lots,
        oracle: route_state.oracle,
        header: state.header,
        rows,
        participants,
    })
}

pub fn initialize(ctx: Context<InitializeResolution>) -> Result<()> {
    require!(
        crate::financial_profile()
            && ctx.remaining_accounts.is_empty()
            && ctx.accounts.market.mode == 2
            && !ctx.accounts.market.paused,
        ClearingError::Profile
    );
    let resolution = &mut ctx.accounts.resolution;
    resolution.version = 1;
    resolution.market = ctx.accounts.market.key();
    resolution.bump = ctx.bumps.resolution;
    Ok(())
}

/// Close the currently held diagnostic interval exactly once when entering freeze.
/// Charges have already been materialized by the causal oracle prefix function.
#[inline(never)]
fn freeze_coverage(
    market: &MarketState,
    observation: &mut crate::state::OracleState,
    now: i64,
) -> Result<()> {
    if observation.sampled_at == 0 {
        return Ok(());
    }
    let elapsed = u64::try_from(
        now.checked_sub(observation.sampled_at)
            .ok_or(ClearingError::Arithmetic)?,
    )
    .map_err(|_| error!(ClearingError::Resolution))?;
    let covered = if observation.held_until > observation.sampled_at {
        (market.funding_time.min(observation.held_until) - observation.sampled_at).max(0) as u64
    } else {
        0
    };
    require!(covered <= elapsed, ClearingError::Resolution);
    observation.covered_seconds = observation
        .covered_seconds
        .checked_add(covered)
        .ok_or(ClearingError::Arithmetic)?;
    observation.skipped_seconds = observation
        .skipped_seconds
        .checked_add(elapsed - covered)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(())
}

pub fn freeze(
    ctx: Context<FreezeMarket>,
    sequence: u64,
    observation: u64,
    emergency: bool,
) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    require!(
        crate::financial_profile()
            && ctx.remaining_accounts.is_empty()
            && accounts.market.mode == 2,
        ClearingError::Profile
    );
    custody::profile(&accounts.market)?;
    custody::reconciled(&accounts.market, accounts.vault.amount)?;
    require!(
        accounts.market.sequence == sequence
            && accounts.route_state.observation_sequence == observation,
        ClearingError::FinancialSequence
    );
    require!(
        accounts.resolution.version == 1
            && matches!(accounts.resolution.header.stage, IDLE | RESUMED),
        ClearingError::Resolution
    );
    let identity = registry_hash(&accounts.registry)?;
    require!(
        accounts
            .registry
            .members
            .get(usize::from(accounts.target.id))
            == Some(&accounts.target.key()),
        ClearingError::Resolution
    );
    let now = Clock::get()?.unix_timestamp;
    let bounds = sources(
        [
            &accounts.primary_btc,
            &accounts.primary_collateral,
            &accounts.guard_btc,
            &accounts.guard_collateral,
        ],
        &mut accounts.route_state.oracle,
        now,
    )?;
    oracle::materialize(&mut accounts.market, &accounts.route_state)?;
    let price = if let Some(bounds) = bounds {
        require!(!emergency, ClearingError::Resolution);
        let participant = routes::participant_model(&accounts.target)?;
        require!(
            checked(math::scaled(participant.cash))?
                .checked_add(checked(
                    participant.unpaid(bounds.reference, accounts.market.funding_index_scaled)
                )?)
                .ok_or(ClearingError::Arithmetic)?
                < 0,
            ClearingError::Resolution
        );
        bounds.reference
    } else {
        require!(
            emergency
                && accounts.caller.key() == accounts.market.authority
                && accounts.route_state.oracle.source_deadline > 0
                && now
                    >= accounts
                        .route_state
                        .oracle
                        .source_deadline
                        .checked_add(30)
                        .ok_or(ClearingError::Arithmetic)?,
            ClearingError::Resolution
        );
        0
    };
    freeze_coverage(&accounts.market, &mut accounts.route_state.oracle, now)?;
    let header = ResolutionHeader {
        epoch: next(accounts.resolution.header.epoch)?,
        stage: if price == 0 { AWAIT_VALUATION } else { VALUE },
        count: accounts.registry.count,
        registry_hash: identity,
        price,
        funding: accounts.market.funding_index_scaled,
        frozen_at: now,
        initial_cash: accounts.market.total_cash,
        initial_pool: accounts.market.settlement,
        initial_insurance: accounts.market.insurance,
        initial_fees: accounts.market.fees,
        initial_vault: accounts.market.allocated_vault,
        remaining_gross: accounts.route_state.gross_lots,
        ..ResolutionHeader::default()
    };
    accounts.resolution.header = header;
    accounts.resolution.rows = vec![LegacyResolutionRow::default(); usize::from(header.count)];
    accounts.market.mode = 3;
    accounts.market.paused = true;
    accounts.market.terms_epoch = next(accounts.market.terms_epoch)?;
    accounts.market.config_epoch = next(accounts.market.config_epoch)?;
    cash_invariant(&accounts.market, &header, accounts.vault.amount)?;
    let event = progress(
        &mut accounts.market,
        &accounts.route_state,
        &accounts.resolution,
        0,
        vec![],
        vec![],
    )?;
    emit_cpi!(event);
    Ok(())
}

#[inline(never)]
fn member(
    info: &AccountInfo,
    market: Pubkey,
    registry: &ParticipantRegistry,
    id: usize,
    writable: bool,
) -> Result<Participant> {
    require!(
        info.owner == &crate::ID
            && info.key == &registry.members[id]
            && info.is_writable == writable
            && info.data_len() == 8 + Participant::INIT_SPACE,
        ClearingError::Resolution
    );
    let participant = Participant::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require!(
        participant.schema_version == 1
            && participant.market == market
            && usize::from(participant.id) == id,
        ClearingError::Resolution
    );
    let key = Pubkey::create_program_address(
        &[
            b"participant",
            market.as_ref(),
            participant.owner.as_ref(),
            &[participant.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| error!(ClearingError::Resolution))?;
    require_keys_eq!(key, *info.key, ClearingError::Resolution);
    Ok(participant)
}

pub fn advance(ctx: Context<AdvanceResolution>, epoch: u64, stage: u8, start: u16) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    frozen(
        &accounts.market,
        &accounts.route_state,
        &accounts.registry,
        &accounts.resolution,
        accounts.vault.amount,
        epoch,
    )?;
    require!(
        (VALUE..=RECONCILE).contains(&stage)
            && accounts.resolution.header.stage == stage
            && accounts.resolution.header.cursor == start,
        ClearingError::Resolution
    );
    let page_len = ctx.remaining_accounts.len();
    require!(
        (1..=4).contains(&page_len)
            && usize::from(start) + page_len <= usize::from(accounts.resolution.header.count),
        ClearingError::Resolution
    );
    let (updates, participants) = page(accounts, ctx.remaining_accounts, stage, start)?;
    accounts.resolution.header.cursor = accounts
        .resolution
        .header
        .cursor
        .checked_add(page_len as u16)
        .ok_or(ClearingError::Arithmetic)?;
    if accounts.resolution.header.cursor == accounts.resolution.header.count {
        finish_pass(
            &mut accounts.market,
            &mut accounts.route_state,
            &mut accounts.resolution.header,
        )?;
    }
    cash_invariant(
        &accounts.market,
        &accounts.resolution.header,
        accounts.vault.amount,
    )?;
    let event = progress(
        &mut accounts.market,
        &accounts.route_state,
        &accounts.resolution,
        1,
        updates,
        participants,
    )?;
    emit_cpi!(event);
    Ok(())
}

pub fn recover(ctx: Context<RecoverResolution>, epoch: u64, resume: bool) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    frozen(
        &accounts.market,
        &accounts.route_state,
        &accounts.registry,
        &accounts.resolution,
        accounts.vault.amount,
        epoch,
    )?;
    let now = Clock::get()?.unix_timestamp;
    let bounds = sources(
        [
            &accounts.primary_btc,
            &accounts.primary_collateral,
            &accounts.guard_btc,
            &accounts.guard_collateral,
        ],
        &mut accounts.route_state.oracle,
        now,
    )?;
    let header = &mut accounts.resolution.header;
    let mut kind = 2;
    if header.stage == AWAIT_VALUATION {
        require!(!resume, ClearingError::Resolution);
        let bounds = bounds.ok_or(ClearingError::OraclePolicy)?;
        header.price = bounds.reference;
        header.stage = VALUE;
    } else {
        require!(header.stage == COMPLETE, ClearingError::Resolution);
        if resume {
            require_keys_eq!(
                accounts.caller.key(),
                accounts.market.authority,
                ClearingError::Authority
            );
            require!(
                bounds.is_some_and(|bounds| bounds.normal)
                    && header.recovery_since > 0
                    && header.recovery_last - header.recovery_since >= policy::RECOVERY
                    && now >= header.recovery_last
                    && now - header.recovery_last <= policy::HOLD,
                ClearingError::Resolution
            );
            accounts.market.mode = 2;
            accounts.market.paused = false;
            accounts.market.terms_epoch = next(accounts.market.terms_epoch)?;
            accounts.market.config_epoch = next(accounts.market.config_epoch)?;
            // Funding must qualify anew. No held prefix spans the frozen interval.
            let old = accounts.route_state.oracle;
            accounts.route_state.oracle = crate::state::OracleState {
                sources: old.sources,
                source_sequences: old.source_sequences,
                funding_base: header.funding,
                covered_seconds: old.covered_seconds,
                skipped_seconds: old
                    .skipped_seconds
                    .checked_add(
                        u64::try_from(
                            now.checked_sub(header.frozen_at)
                                .ok_or(ClearingError::Arithmetic)?,
                        )
                        .map_err(|_| error!(ClearingError::Resolution))?,
                    )
                    .ok_or(ClearingError::Arithmetic)?,
                ..crate::state::OracleState::default()
            };
            accounts.route_state.valid_until = 0;
            header.stage = RESUMED;
            kind = 3;
        } else {
            require!(
                header.recovery_last == 0 || now - header.recovery_last >= policy::SAMPLE_INTERVAL,
                ClearingError::Resolution
            );
            if bounds.is_some_and(|bounds| bounds.normal) {
                if header.recovery_since == 0 || now - header.recovery_last > policy::HOLD {
                    header.recovery_since = now;
                }
            } else {
                header.recovery_since = 0;
            }
            header.recovery_last = now;
        }
    }
    let event = progress(
        &mut accounts.market,
        &accounts.route_state,
        &accounts.resolution,
        kind,
        vec![],
        vec![],
    )?;
    emit_cpi!(event);
    Ok(())
}

#[inline(never)]
fn page(
    accounts: &mut AdvanceResolution,
    infos: &[AccountInfo],
    stage: u8,
    start: u16,
) -> Result<(Vec<ResolutionUpdate>, Vec<ResolutionParticipant>)> {
    let page_len = infos.len();
    let writable = matches!(stage, COLLECT | APPLY);
    let mut updates = Vec::with_capacity(page_len);
    let mut participants = Vec::new();
    for (offset, info) in infos.iter().enumerate() {
        let id = usize::from(start) + offset;
        let mut participant = member(
            info,
            accounts.market.key(),
            &accounts.registry,
            id,
            writable,
        )?;
        process_row(
            &mut accounts.market,
            &mut accounts.route_state,
            &mut accounts.resolution,
            id,
            &mut participant,
        )?;
        if writable {
            participant.try_serialize(&mut &mut info.try_borrow_mut_data()?[..])?;
            participants.push(ResolutionParticipant {
                participant: *info.key,
                id: participant.id,
                cash: participant.cash,
                lots: participant.lots,
                virtual_scaled: participant.virtual_scaled,
                funding_checkpoint_scaled: participant.funding_checkpoint_scaled,
                generation: participant.generation,
                finalized: stage == APPLY,
            });
        }
        updates.push(ResolutionUpdate {
            id: id as u16,
            row: accounts.resolution.rows[id],
        });
    }
    Ok((updates, participants))
}

mod ledger;

use ledger::{finish_pass, process_row};

#[cfg(test)]
mod tests;

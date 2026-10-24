//! Authenticated source adapters, causal funding, and G08 action policy.

use crate::error::ClearingError;
use crate::events::OracleObserved;
use crate::instructions::{custody, makers};
use crate::state::{MakerRegistration, MarketState, OracleState, Participant, TestRouteState};

use anchor_lang::prelude::*;

use financial_core::{self as math, oracle as policy};

use oracle_fixture::{Feed, ID as FIXTURE};

pub(crate) fn source_bounds(
    primary: [policy::Price; 2],
    guard: Option<[policy::Price; 2]>,
    now: i64,
) -> math::Result<policy::Bounds> {
    #[cfg(feature = "devnet-test-profile")]
    {
        policy::devnet_bounds(primary, guard, now)
    }
    #[cfg(not(feature = "devnet-test-profile"))]
    {
        policy::bounds(primary, guard, now)
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Box<Account<'info, TestRouteState>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SampleOracle<'info> {
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Box<Account<'info, TestRouteState>>,
    /// CHECK: exact configured PDA, profile owner, discriminator and verified schema below.
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: same checks, distinct collateral feed ID.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: independent fixture key, not claimed independent upstream economics.
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: same checks, guard collateral feed ID.
    pub guard_collateral: UncheckedAccount<'info>,
    #[account(
        seeds = [b"participant", market.key().as_ref(), first_capital.owner.as_ref()],
        bump = first_capital.bump,
        has_one = market,
    )]
    pub first_capital: Box<Account<'info, Participant>>,
    #[account(
        seeds = [b"maker", market.key().as_ref(), &[0]],
        bump = first_registration.bump,
        has_one = market,
        constraint = first_registration.capital == first_capital.key() @ ClearingError::MakerBinding,
    )]
    pub first_registration: Box<Account<'info, MakerRegistration>>,
    #[account(address=makers::MAKER_A)]
    pub first_program: Program<'info>,
    #[account(address=first_registration.program_data)]
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: quote_checked validates exact registration/config/program bindings.
    #[account(address=first_registration.config)]
    pub first_config: UncheckedAccount<'info>,
    #[account(
        seeds = [b"participant", market.key().as_ref(), second_capital.owner.as_ref()],
        bump = second_capital.bump,
        has_one = market,
    )]
    pub second_capital: Box<Account<'info, Participant>>,
    #[account(
        seeds = [b"maker", market.key().as_ref(), &[1]],
        bump = second_registration.bump,
        has_one = market,
        constraint = second_registration.capital == second_capital.key() @ ClearingError::MakerBinding,
    )]
    pub second_registration: Box<Account<'info, MakerRegistration>>,
    #[account(address=makers::MAKER_B)]
    pub second_program: Program<'info>,
    #[account(address=second_registration.program_data)]
    pub second_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: quote_checked validates exact registration/config/program bindings.
    #[account(address=second_registration.config)]
    pub second_config: UncheckedAccount<'info>,
}

fn event(
    market: &mut Account<MarketState>,
    route_state: &mut TestRouteState,
) -> Result<OracleObserved> {
    market.sequence = market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    route_state.observation_sequence = route_state
        .observation_sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(OracleObserved {
        version: 1,
        domain: market.domain,
        market: market.key(),
        sequence: market.sequence,
        slot: Clock::get()?.slot,
        terms_epoch: market.terms_epoch,
        config_epoch: market.config_epoch,
        observation_sequence: route_state.observation_sequence,
        reference_price: route_state.reference_price,
        lower: route_state.lower,
        upper: route_state.upper,
        valid_from: route_state.valid_from,
        valid_until: route_state.valid_until,
        funding_index_scaled: market.funding_index_scaled,
        funding_time: market.funding_time,
        oracle: route_state.oracle,
    })
}

pub fn initialize(ctx: Context<InitializeOracle>, primary: Pubkey, guard: Pubkey) -> Result<()> {
    require!(crate::financial_profile(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    custody::profile(&accounts.market)?;
    require!(
        accounts.market.mode == 1
            && !accounts.market.paused
            && primary != guard
            && primary != Pubkey::default()
            && guard != Pubkey::default(),
        ClearingError::OraclePolicy
    );
    let mut sources = [Pubkey::default(); 4];
    #[cfg(feature = "devnet-test-profile")]
    require!(
        primary == crate::pyth_core::RECEIVER,
        ClearingError::OracleSource
    );
    for (source_index, source) in sources.iter_mut().enumerate() {
        #[cfg(feature = "devnet-test-profile")]
        if source_index < 2 {
            *source = crate::pyth_core::ACCOUNTS[source_index];
            continue;
        }
        let authority = if source_index < 2 { primary } else { guard };
        *source = Pubkey::find_program_address(
            &[b"feed", authority.as_ref(), &[source_index as u8 + 1; 32]],
            &FIXTURE,
        )
        .0;
    }
    accounts.market.mode = 2;
    accounts.market.config_epoch = accounts
        .market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    accounts.route_state.oracle = OracleState {
        sources,
        ..OracleState::default()
    };
    accounts.route_state.valid_until = 0;
    let event = event(&mut accounts.market, &mut accounts.route_state)?;
    emit_cpi!(event);
    Ok(())
}

pub(crate) fn source(
    info: &AccountInfo,
    expected: Pubkey,
    index: usize,
    sequence: u64,
) -> Result<(policy::Price, u64)> {
    binding(info, expected, index)?;
    #[cfg(feature = "devnet-test-profile")]
    if index < 2 {
        return crate::pyth_core::decode(info, index, sequence, Clock::get()?.slot)
            .ok_or_else(|| error!(ClearingError::OracleSource));
    }
    require!(
        info.key == &expected && info.owner == &FIXTURE && !info.is_writable,
        ClearingError::OracleSource
    );
    let bytes = info.try_borrow_data()?;
    require!(
        bytes.len() == 8 + Feed::INIT_SPACE,
        ClearingError::OracleSource
    );
    let feed = Feed::try_deserialize(&mut &bytes[..])?;
    require!(
        feed.feed_id == [index as u8 + 1; 32]
            && feed.value.verifier == FIXTURE
            && feed.value.level == 2
            && feed.sequence > 0
            && feed.sequence >= sequence,
        ClearingError::OracleSource
    );
    Ok((
        policy::Price {
            value: feed.value.price,
            confidence: feed.value.confidence,
            exponent: feed.value.exponent,
            published: feed.value.published,
        },
        feed.sequence,
    ))
}

/// Bad account substitution rejects before a policy failure can be recorded.
pub(crate) fn binding(info: &AccountInfo, expected: Pubkey, index: usize) -> Result<()> {
    #[cfg(feature = "devnet-test-profile")]
    let owner = if index < 2 {
        crate::pyth_core::RECEIVER
    } else {
        FIXTURE
    };
    #[cfg(not(feature = "devnet-test-profile"))]
    let owner = {
        let _ = index;
        FIXTURE
    };
    require!(
        info.key == &expected && info.owner == &owner && !info.is_writable && !info.executable,
        ClearingError::OracleSource
    );
    Ok(())
}

/// Prefix evaluation is independent of the number of accruals/trades in the hold.
pub fn funding(
    market: &MarketState,
    route_state: &TestRouteState,
    now: i64,
    slot: u64,
) -> Result<i128> {
    if market.mode != 2 {
        return Ok(market.funding_index_scaled);
    }
    let observation = &route_state.oracle;
    if observation.held_epoch != market.config_epoch
        || observation.held_until <= observation.sampled_at
        || slot >= observation.held_slot
        || now < observation.sampled_at
        || now - observation.sampled_at > policy::MAX_CATCHUP
    {
        return Ok(market.funding_index_scaled);
    }
    policy::endpoint(
        observation.funding_base,
        observation.premium_scaled,
        observation.sampled_at,
        observation.held_until,
        now,
    )
    .map_err(|_| error!(ClearingError::Arithmetic))
}

pub fn materialize(market: &mut MarketState, route_state: &TestRouteState) -> Result<()> {
    let clock = Clock::get()?;
    market.funding_index_scaled = funding(market, route_state, clock.unix_timestamp, clock.slot)?;
    let observation = &route_state.oracle;
    if market.mode == 2
        && observation.held_epoch == market.config_epoch
        && observation.held_until > observation.sampled_at
        && clock.slot < observation.held_slot
        && clock.unix_timestamp >= observation.sampled_at
        && clock.unix_timestamp - observation.sampled_at <= policy::MAX_CATCHUP
    {
        market.funding_time = clock.unix_timestamp.min(observation.held_until);
    }
    Ok(())
}

pub fn effective(market: &MarketState, route_state: &TestRouteState) -> Result<i128> {
    let clock = Clock::get()?;
    funding(market, route_state, clock.unix_timestamp, clock.slot)
}

/// Conservative endpoint for a cohort certificate; no participant is valued with a different aggregate F.
pub fn funding_bounds(market: &MarketState, route_state: &TestRouteState) -> Result<[i128; 2]> {
    let current = effective(market, route_state)?;
    let observation = &route_state.oracle;
    let end = if market.mode == 2
        && observation.held_epoch == market.config_epoch
        && observation.held_until > observation.sampled_at
    {
        policy::endpoint(
            observation.funding_base,
            observation.premium_scaled,
            observation.sampled_at,
            observation.held_until,
            observation.held_until,
        )
        .map_err(|_| error!(ClearingError::Arithmetic))?
    } else {
        current
    };
    Ok([
        current.min(end).min(market.funding_index_scaled),
        current.max(end).max(market.funding_index_scaled),
    ])
}

pub fn action(market: &MarketState, route_state: &TestRouteState, increase: bool) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.slot >= route_state.valid_from && clock.slot < route_state.valid_until,
        ClearingError::RiskObservation
    );
    if market.mode == 2 {
        let observation = &route_state.oracle;
        require!(
            observation.status > 0
                && clock.unix_timestamp >= observation.sampled_at
                && clock.unix_timestamp < observation.source_deadline,
            ClearingError::OraclePolicy
        );
        if increase {
            require!(
                observation.status == 2
                    && observation.held_epoch == market.config_epoch
                    && clock.unix_timestamp - observation.last_qualified < policy::FUNDING_OUTAGE,
                ClearingError::OraclePolicy
            );
        }
    }
    Ok(())
}

pub fn sample(ctx: Context<SampleOracle>) -> Result<()> {
    require!(
        crate::financial_profile() && ctx.remaining_accounts.is_empty(),
        ClearingError::Profile
    );
    let accounts = &mut *ctx.accounts;
    custody::profile(&accounts.market)?;
    require!(
        accounts.market.mode == 2 && !accounts.market.paused,
        ClearingError::Profile
    );
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let old = accounts.route_state.oracle;
    require!(
        now > 0 && (old.sampled_at == 0 || now - old.sampled_at >= policy::SAMPLE_INTERVAL),
        ClearingError::OraclePolicy
    );
    let sources = [
        &accounts.primary_btc,
        &accounts.primary_collateral,
        &accounts.guard_btc,
        &accounts.guard_collateral,
    ];
    let mut values = [None; 4];
    let mut sequences = old.source_sequences;
    for source_index in 0..4 {
        // Bad account selection is a rejected caller attempt, never evidence that a
        // configured authenticated source failed (which would permit griefing).
        binding(
            sources[source_index],
            old.sources[source_index],
            source_index,
        )?;
        if let Ok((source_price, source_sequence)) = source(
            sources[source_index],
            old.sources[source_index],
            source_index,
            sequences[source_index],
        ) {
            values[source_index] = Some(source_price);
            sequences[source_index] = source_sequence;
        }
    }
    let bounds = values[0]
        .zip(values[1])
        .and_then(|(source_price, collateral_price)| {
            source_bounds(
                [source_price, collateral_price],
                values[2]
                    .zip(values[3])
                    .map(|(source_price, collateral_price)| [source_price, collateral_price]),
                now,
            )
            .ok()
        });
    let gap = old.sampled_at > 0 && now - old.sampled_at > policy::MAX_CATCHUP;
    let changed = old.held_epoch != accounts.market.config_epoch;
    let current = effective(&accounts.market, &accounts.route_state)?;
    let sampled = if let Some(bounds) = bounds.filter(|bounds| bounds.normal) {
        impact(accounts, bounds, current).ok()
    } else {
        None
    };
    // If required maker terms cannot be revalidated, preserve materialized charges
    // and explicitly discard unverified pending coverage. Never rewrite old participants.
    let preserve = !gap && !changed && sampled.is_some();
    let funding_index = if preserve {
        current
    } else {
        accounts.market.funding_index_scaled
    };
    let elapsed = if old.sampled_at > 0 {
        (now - old.sampled_at) as u64
    } else {
        0
    };
    let covered = if preserve {
        (now.min(old.held_until) - old.sampled_at).max(0) as u64
    } else if old.held_until > old.sampled_at {
        (accounts.market.funding_time.min(old.held_until) - old.sampled_at).max(0) as u64
    } else {
        0
    };
    let mut observation = OracleState {
        sources: old.sources,
        source_sequences: sequences,
        sampled_at: now,
        // A restrictive sample must not erase the last credible deadline and
        // indefinitely prevent the authority's source-emergency grace proof.
        // status=0 and valid_until=0 still prohibit every priced action.
        source_deadline: old.source_deadline,
        funding_base: funding_index,
        held_epoch: accounts.market.config_epoch,
        covered_seconds: old
            .covered_seconds
            .checked_add(covered)
            .ok_or(ClearingError::Arithmetic)?,
        skipped_seconds: old
            .skipped_seconds
            .checked_add(elapsed.saturating_sub(covered))
            .ok_or(ClearingError::Arithmetic)?,
        outcome: if gap {
            3
        } else if changed && old.sampled_at > 0 {
            4
        } else if bounds.is_none() {
            1
        } else if sampled.is_none() {
            2
        } else {
            0
        },
        last_qualified: old.last_qualified,
        ..OracleState::default()
    };
    if let Some(bounds) = bounds {
        accounts.route_state.reference_price = bounds.reference;
        accounts.route_state.lower = bounds.lower;
        accounts.route_state.upper = bounds.upper;
        accounts.route_state.valid_from = clock.slot;
        accounts.route_state.valid_until = clock
            .slot
            .checked_add(3600)
            .ok_or(ClearingError::Arithmetic)?;
        observation.source_deadline = bounds.deadline;
        observation.status = 1;
        if let Some((quantity, bid, ask)) = sampled {
            observation.quantity = quantity;
            observation.bid = bid;
            observation.ask = ask;
            observation.premium_scaled = policy::premium(bounds.reference, quantity, bid, ask)
                .map_err(|_| error!(ClearingError::OraclePolicy))?;
            observation.held_until = (now + policy::HOLD).min(bounds.deadline);
            observation.held_slot = accounts
                .first_registration
                .expiry_slot
                .min(accounts.second_registration.expiry_slot);
            observation.last_qualified = now;
            observation.valid_since = if old.valid_since > 0
                && now - old.sampled_at <= policy::HOLD
                && old.held_epoch == accounts.market.config_epoch
            {
                old.valid_since
            } else {
                now
            };
            if now - observation.valid_since >= policy::RECOVERY {
                observation.status = 2;
            }
        }
    } else {
        accounts.route_state.valid_until = 0;
    }
    accounts.market.funding_index_scaled = funding_index;
    accounts.market.funding_time = now;
    accounts.route_state.oracle = observation;
    let event = event(&mut accounts.market, &mut accounts.route_state)?;
    emit_cpi!(event);
    Ok(())
}

mod impact;

use impact::impact;

//! D75/D76 restricted funding publication. Maker prices are an explicit backend
//! attestation; independent risk sources and causal funding remain on-chain.
use super::*;
use crate::instructions::account_trading;
use crate::state::liquidity::{FundingPublisher, FundingPublisherPayload, FundingReport};
use financial_core::oracle as policy;

mod contexts;
pub use contexts::*;
mod validation;
use validation::*;
#[cfg(test)]
mod tests;

pub fn initialize(
    ctx: &mut Context<InitializeFundingPublisher>,
    events: &mut crate::event_cpi::Payloads,
    publisher: Pubkey,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    execution_profile(
        &accounts.venue,
        &accounts.custody,
        &accounts.safety,
        &accounts.market,
    )?;
    require!(
        accounts.safety.mode == CUSTODY
            && publisher != Pubkey::default()
            && accounts
                .market
                .oracle
                .sources
                .iter()
                .all(|key| *key != Pubkey::default()),
        ClearingError::FundingReport
    );
    pricing::sealed_registry(
        &accounts.registry,
        accounts.venue.key(),
        accounts.market.key(),
    )?;
    let clock = Clock::get()?;
    accounts.configuration.set_inner(FundingPublisher {
        revision: 0,
        schema_version: 5,
        venue: accounts.venue.key(),
        market: accounts.market.key(),
        publisher,
        authority_epoch: 1,
        last_sequence: 0,
        last_observed_slot: clock.slot,
        last_observed_time: clock.unix_timestamp,
        enabled: true,
        bump: ctx.bumps.configuration,
    });

    events.emit(
        &FundingPublisherChanged {
            venue: accounts.venue.key(),

            slot: clock.slot,
            market: accounts.market.key(),
            configuration: accounts.configuration.key(),
            state: FundingPublisherPayload::from(&**accounts.configuration),
            market_state: MarketSnapshot::from(&**accounts.market),
        },
        accounts.event_authority.to_account_info(),
    )
}

pub fn configure(
    ctx: &mut Context<ConfigureFundingPublisher>,
    events: &mut crate::event_cpi::Payloads,
    expected_authority: u64,
    publisher: Pubkey,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && accounts.venue.schema_version == 5
            && accounts.venue.profile_version == 4
            && accounts.venue.market_count == 2
            && accounts.venue.insurance_fee_share_bps == 2500
            && accounts.custody.schema_version == 5
            && accounts.safety.schema_version == 5
            && accounts.market.schema_version == 5
            && accounts.configuration.schema_version == 5
            && accounts.configuration.authority_epoch == expected_authority
            && expected_authority > 0
            && matches!(
                accounts.safety.mode,
                CUSTODY | ACTIVE | FROZEN | RESOLVED | RETIRED
            ),
        ClearingError::FundingReport
    );
    let enabled = publisher != Pubkey::default();
    require!(
        !enabled || (!accounts.safety.paused && matches!(accounts.safety.mode, CUSTODY | ACTIVE)),
        ClearingError::FundingReport
    );
    let clock = Clock::get()?;
    if matches!(accounts.safety.mode, CUSTODY | ACTIVE) {
        let mut next = funding::control_candidate(accounts.safety.mode, &accounts.market, &clock)?;
        increment(&mut next.observation_sequence)?;
        accounts.market.set_inner(next);
    }
    increment(&mut accounts.configuration.authority_epoch)?;
    accounts.configuration.publisher = publisher;
    accounts.configuration.enabled = enabled;
    accounts.configuration.last_observed_slot = clock.slot;
    accounts.configuration.last_observed_time = clock.unix_timestamp;

    events.emit(
        &FundingPublisherChanged {
            venue: accounts.venue.key(),

            slot: clock.slot,
            market: accounts.market.key(),
            configuration: accounts.configuration.key(),
            state: FundingPublisherPayload::from(&**accounts.configuration),
            market_state: MarketSnapshot::from(&**accounts.market),
        },
        accounts.event_authority.to_account_info(),
    )
}

pub fn publish(
    ctx: &mut Context<PublishFundingReport>,
    events: &mut crate::event_cpi::Payloads,
    report: FundingReport,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    execution_profile(
        &accounts.venue,
        &accounts.custody,
        &accounts.safety,
        &accounts.market,
    )?;
    let clock = Clock::get()?;
    validate_report(
        &accounts.venue,
        &accounts.market,
        &accounts.configuration,
        &report,
        &clock,
    )?;
    let (bounds, sequences) = read_sources(
        &accounts.market,
        [
            &accounts.primary_asset,
            &accounts.primary_collateral,
            &accounts.guard_asset,
            &accounts.guard_collateral,
        ],
        &clock,
    )?;
    let impact = report_impact(&report, bounds)?;
    let mut next = funding::sample_candidate(
        accounts.safety.mode,
        &accounts.market,
        &clock,
        bounds,
        sequences,
        impact.as_ref(),
    )?;
    increment(&mut next.observation_sequence)?;
    accounts.market.set_inner(next);
    accounts.configuration.last_sequence = report.sequence;
    accounts.configuration.last_observed_slot = report.observed_slot;
    accounts.configuration.last_observed_time = report.observed_time;

    events.emit(
        &FundingReportAccepted {
            venue: accounts.venue.key(),

            slot: clock.slot,
            market: accounts.market.key(),
            publisher: accounts.publisher.key(),
            report,
            state: MarketSnapshot::from(&**accounts.market),
        },
        accounts.event_authority.to_account_info(),
    )
}

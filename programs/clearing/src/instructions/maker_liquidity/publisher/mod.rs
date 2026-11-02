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
    publisher: Address,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    execution_profile(&accounts.venue, &accounts.safety, &accounts.market)?;
    require!(
        accounts.safety.mode == CUSTODY
            && publisher != Address::default()
            && accounts
                .market
                .oracle
                .sources
                .iter()
                .all(|key| *key != Address::default()),
        ClearingError::FundingReport
    );
    pricing::sealed_registry(
        &accounts.registry,
        accounts.venue.address().to_owned(),
        accounts.market.address().to_owned(),
    )?;
    let clock = Clock::get()?;
    **accounts.configuration = FundingPublisher {
        revision: 0,
        schema_version: 8,
        venue: accounts.venue.address().to_owned(),
        market: accounts.market.address().to_owned(),
        publisher,
        authority_epoch: 1,
        last_sequence: 0,
        last_observed_slot: clock.slot,
        last_observed_time: clock.unix_timestamp,
        enabled: true,
        bump: ctx.bumps.configuration,
    };

    events.emit(
        &FundingPublisherChanged {
            venue: accounts.venue.address().to_owned(),

            slot: clock.slot,
            market: accounts.market.address().to_owned(),
            configuration: accounts.configuration.address().to_owned(),
            state: FundingPublisherPayload::from(&**accounts.configuration),
            market_state: MarketSnapshot::from(&**accounts.market),
        },
        accounts.event_authority.account().clone(),
    )
}

pub fn configure(
    ctx: &mut Context<ConfigureFundingPublisher>,
    events: &mut crate::event_cpi::Payloads,
    expected_authority: u64,
    publisher: Address,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && accounts.venue.schema_version == 8
            && accounts.venue.profile_version == 4
            && accounts.venue.market_count == 2
            && accounts.venue.insurance_fee_share_bps == 2500
            && accounts.safety.schema_version == 8
            && accounts.market.schema_version == 8
            && accounts.configuration.schema_version == 8
            && accounts.configuration.authority_epoch == expected_authority
            && expected_authority > 0
            && matches!(
                accounts.safety.mode,
                CUSTODY | ACTIVE | FROZEN | RESOLVED | RETIRED
            ),
        ClearingError::FundingReport
    );
    let enabled = publisher != Address::default();
    require!(
        !enabled || (!accounts.safety.paused && matches!(accounts.safety.mode, CUSTODY | ACTIVE)),
        ClearingError::FundingReport
    );
    let clock = Clock::get()?;
    if matches!(accounts.safety.mode, CUSTODY | ACTIVE) {
        let mut next = funding::control_candidate(accounts.safety.mode, &accounts.market, &clock)?;
        increment(&mut next.observation_sequence)?;
        **accounts.market = next;
    }
    increment(&mut accounts.configuration.authority_epoch)?;
    accounts.configuration.publisher = publisher;
    accounts.configuration.enabled = enabled;
    accounts.configuration.last_observed_slot = clock.slot;
    accounts.configuration.last_observed_time = clock.unix_timestamp;

    events.emit(
        &FundingPublisherChanged {
            venue: accounts.venue.address().to_owned(),

            slot: clock.slot,
            market: accounts.market.address().to_owned(),
            configuration: accounts.configuration.address().to_owned(),
            state: FundingPublisherPayload::from(&**accounts.configuration),
            market_state: MarketSnapshot::from(&**accounts.market),
        },
        accounts.event_authority.account().clone(),
    )
}

pub fn publish(
    ctx: &mut Context<PublishFundingReport>,
    events: &mut crate::event_cpi::Payloads,
    report: FundingReport,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    execution_profile(&accounts.venue, &accounts.safety, &accounts.market)?;
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
    **accounts.market = next;
    accounts.configuration.last_sequence = report.sequence;
    accounts.configuration.last_observed_slot = report.observed_slot;
    accounts.configuration.last_observed_time = report.observed_time;

    events.emit(
        &FundingReportAccepted {
            venue: accounts.venue.address().to_owned(),

            slot: clock.slot,
            market: accounts.market.address().to_owned(),
            publisher: accounts.publisher.address().to_owned(),
            report,
            state: MarketSnapshot::from(&**accounts.market),
        },
        accounts.event_authority.account().clone(),
    )
}

//! Restricted funding publication for a sealed listing. An inactive book may
//! qualify its price source before it has positions or earns funding.
use super::*;
use crate::instructions::listing_index::source_observation;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeListedFunding {
    #[account(mut)]
    pub authority: Signer,
    #[account(seeds=[b"venue-v3", &venue.domain], bump=venue.bump, has_one=authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds=[b"market-listing",venue.address().as_ref(),&listing.market_id.to_le_bytes()],bump=listing.bump,has_one=venue)]
    pub listing: Box<BorshAccount<MarketListing>>,
    #[account(seeds=[b"listing-index",listing.address().as_ref()],bump=listing_index.bump,has_one=listing)]
    pub listing_index: Box<BorshAccount<ListingIndex>>,
    #[account(seeds=[b"liquidity-v4",listing.address().as_ref()],bump=registry.bump)]
    pub registry: Box<BorshAccount<LiquidityRegistry>>,
    #[account(init,payer=authority,space=8+ListedFunding::INIT_SPACE,seeds=[b"listed-funding",listing.address().as_ref()],bump)]
    pub funding: Box<BorshAccount<ListedFunding>>,
    #[account(init,payer=authority,space=8+FundingPublisher::INIT_SPACE,seeds=[b"funding-publisher-v4",listing.address().as_ref()],bump)]
    pub configuration: Box<BorshAccount<FundingPublisher>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ConfigureListedFunding {
    pub authority: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump,has_one=authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds=[b"market-listing",venue.address().as_ref(),&listing.market_id.to_le_bytes()],bump=listing.bump,has_one=venue)]
    pub listing: Box<BorshAccount<MarketListing>>,
    #[account(mut,seeds=[b"listed-funding",listing.address().as_ref()],bump=funding.bump,has_one=listing)]
    pub funding: Box<BorshAccount<ListedFunding>>,
    #[account(mut,seeds=[b"funding-publisher-v4",listing.address().as_ref()],bump=configuration.bump,has_one=venue,
        constraint=configuration.market==*listing.address() @ ClearingError::FundingReport)]
    pub configuration: Box<BorshAccount<FundingPublisher>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PublishListedFunding {
    pub publisher: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds=[b"market-listing",venue.address().as_ref(),&listing.market_id.to_le_bytes()],bump=listing.bump,has_one=venue)]
    pub listing: Box<BorshAccount<MarketListing>>,
    #[account(seeds=[b"listing-index",listing.address().as_ref()],bump=listing_index.bump,has_one=listing)]
    pub listing_index: Box<BorshAccount<ListingIndex>>,
    #[account(mut,seeds=[b"listed-funding",listing.address().as_ref()],bump=funding.bump,has_one=listing)]
    pub funding: Box<BorshAccount<ListedFunding>>,
    #[account(mut,seeds=[b"funding-publisher-v4",listing.address().as_ref()],bump=configuration.bump,has_one=venue,has_one=publisher,
        constraint=configuration.market==*listing.address() @ ClearingError::FundingReport)]
    pub configuration: Box<BorshAccount<FundingPublisher>>,
    /// CHECK: Four immutable feed bindings are read independently at landing.
    pub primary_asset: UncheckedAccount,
    /// CHECK: Bound collateral primary.
    pub primary_collateral: UncheckedAccount,
    /// CHECK: Bound asset guard.
    pub guard_asset: UncheckedAccount,
    /// CHECK: Bound collateral guard.
    pub guard_collateral: UncheckedAccount,
}

fn enabled(venue: &Venue, safety: &VenueSafety, listing: &MarketListing) -> Result<()> {
    #[cfg(feature = "listed-venue-execution")]
    if venue.profile_version == LISTED_VENUE_PROFILE {
        crate::instructions::maker_liquidity::routes::listed_venue::identity(venue, safety)?;
        require!(listing.schema_version == LISTING_SCHEMA && listing.status == LISTING_QUALIFICATION
            && listing.quote_mint == venue.quote_mint, ClearingError::FundingReport);
        return Ok(());
    }
    account_trading::base_identity(venue, safety)?;
    require!(
        !safety.paused
            && listing.schema_version == LISTING_SCHEMA
            && listing.status == LISTING_MAKERS_SEALED
            && listing.quote_mint == venue.quote_mint,
        ClearingError::FundingReport
    );
    Ok(())
}

fn emit(
    venue: Address,
    clock: &Clock,
    funding: &BorshAccount<ListedFunding>,
    configuration: &BorshAccount<FundingPublisher>,
    report: Option<FundingReport>,
    events: &mut crate::event_cpi::Payloads,
    authority: &AccountView,
) -> Result<()> {
    events.emit(
        &ListedFundingChanged {
            venue,
            slot: clock.slot,
            listing: funding.listing,
            funding: *funding.address(),
            configuration: *configuration.address(),
            values: funding.values.clone(),
            publisher: FundingPublisherPayload::from(&**configuration),
            report,
        },
        authority.clone(),
    )
}

pub fn initialize(
    ctx: &mut Context<InitializeListedFunding>,
    events: &mut crate::event_cpi::Payloads,
    publisher: Address,
) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let a = &mut ctx.accounts;
    enabled(&a.venue, &a.safety, &a.listing)?;
    let venue = *a.venue.address();
    let listing = *a.listing.address();
    pricing::sealed_registry(&a.registry, venue, listing)?;
    require!(
        publisher != Address::default()
            && a.listing_index.schema_version == LISTING_SCHEMA
            && a.listing_index.sources[0] == a.listing.oracle_feed
            && financial_core::price_policy::source_multiplier(a.listing.lots_per_unit).is_some(),
        ClearingError::FundingReport
    );
    let clock = Clock::get()?;
    **a.funding = ListedFunding {
        schema_version: LISTING_SCHEMA,
        revision: 0,
        listing,
        values: ListedFundingValues {
            oracle: crate::state::OracleState {
                sources: a.listing_index.sources,
                ..Default::default()
            },
            ..Default::default()
        },
        bump: ctx.bumps.funding,
    };
    **a.configuration = FundingPublisher {
        schema_version: SCHEMA_VERSION,
        revision: 0,
        venue,
        market: listing,
        publisher,
        authority_epoch: 1,
        last_sequence: 0,
        last_observed_slot: clock.slot,
        last_observed_time: clock.unix_timestamp,
        enabled: true,
        bump: ctx.bumps.configuration,
    };
    emit(
        venue,
        &clock,
        &a.funding,
        &a.configuration,
        None,
        events,
        a.event_authority.account(),
    )
}

pub fn configure(
    ctx: &mut Context<ConfigureListedFunding>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
    publisher: Address,
) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let a = &mut ctx.accounts;
    let active = publisher != Address::default();
    if active {
        enabled(&a.venue, &a.safety, &a.listing)?;
    }
    require!(
        a.configuration.authority_epoch == epoch
            && epoch > 0
            && a.listing.status == LISTING_MAKERS_SEALED,
        ClearingError::FundingReport
    );
    let clock = Clock::get()?;
    let mut next =
        funding::control_admitted_market(CUSTODY, &a.funding.values.market(&a.listing), &clock)?;
    increment(&mut next.observation_sequence)?;
    a.funding.values = ListedFundingValues::from(&next);
    increment(&mut a.configuration.authority_epoch)?;
    a.configuration.publisher = publisher;
    a.configuration.enabled = active;
    a.configuration.last_observed_slot = clock.slot;
    a.configuration.last_observed_time = clock.unix_timestamp;
    emit(
        *a.venue.address(),
        &clock,
        &a.funding,
        &a.configuration,
        None,
        events,
        a.event_authority.account(),
    )
}

pub fn publish(
    ctx: &mut Context<PublishListedFunding>,
    events: &mut crate::event_cpi::Payloads,
    report: FundingReport,
) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let a = &mut ctx.accounts;
    enabled(&a.venue, &a.safety, &a.listing)?;
    let clock = Clock::get()?;
    let market = a.funding.values.market(&a.listing);
    validate_report(&a.venue, &market, &a.configuration, &report, &clock)?;
    require!(
        a.listing_index.sources == market.oracle.sources,
        ClearingError::OracleSource
    );
    let floors = core::array::from_fn(|i| {
        a.listing_index.source_sequences[i].max(market.oracle.source_sequences[i])
    });
    let (bounds, sequences) = source_observation(
        &a.listing,
        &a.listing_index.sources,
        floors,
        [
            &a.primary_asset,
            &a.primary_collateral,
            &a.guard_asset,
            &a.guard_collateral,
        ],
        clock.unix_timestamp,
    )?;
    let impact = report_impact(&report, bounds)?;
    let mode = if cfg!(feature="listed-venue-execution") && a.listing.status == LISTING_QUALIFICATION { ACTIVE } else { CUSTODY };
    let mut next = funding::sample_admitted_market(
        mode,
        &market,
        &clock,
        bounds,
        sequences,
        impact.as_ref(),
    )?;
    increment(&mut next.observation_sequence)?;
    a.funding.values = ListedFundingValues::from(&next);
    a.configuration.last_sequence = report.sequence;
    a.configuration.last_observed_slot = report.observed_slot;
    a.configuration.last_observed_time = report.observed_time;
    emit(
        *a.venue.address(),
        &clock,
        &a.funding,
        &a.configuration,
        Some(report),
        events,
        a.event_authority.account(),
    )
}

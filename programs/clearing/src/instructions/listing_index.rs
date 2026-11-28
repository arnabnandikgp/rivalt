//! Bind an inactive listing to the venue's collateral feeds, then allow anyone
//! to record a qualified asset/collateral index. Neither operation enables trading.
use super::market_listing::{feed_id, fixture_feed};
use crate::{event_cpi::Payloads, events::ListingIndexChanged, state::accounts::*, ClearingError};
use anchor_lang::prelude::*;
use financial_core::oracle as policy;

#[event_cpi]
#[derive(Accounts)]
pub struct BindListingIndex {
    #[account(mut)]
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds = [b"market-listing", venue.address().as_ref(), &listing.market_id.to_le_bytes()], bump = listing.bump, has_one = venue)]
    pub listing: Box<BorshAccount<MarketListing>>,
    #[account(address = venue.markets[0], has_one = venue)]
    pub market: Box<BorshAccount<Market>>,
    #[account(init, payer = authority, space = 8 + ListingIndex::INIT_SPACE,
        seeds = [b"listing-index", listing.address().as_ref()], bump)]
    pub listing_index: Box<BorshAccount<ListingIndex>>,
    /// CHECK: Both collateral accounts are read-only oracle feeds pinned by the venue market.
    pub primary_collateral: UncheckedAccount,
    /// CHECK: Its authenticated publisher determines the independent underlying guard.
    pub guard_collateral: UncheckedAccount,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ObserveListingIndex {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds = [b"market-listing", venue.address().as_ref(), &listing.market_id.to_le_bytes()], bump = listing.bump, has_one = venue)]
    pub listing: Box<BorshAccount<MarketListing>>,
    #[account(mut, seeds = [b"listing-index", listing.address().as_ref()], bump = listing_index.bump, has_one = listing)]
    pub listing_index: Box<BorshAccount<ListingIndex>>,
    /// CHECK: Each read-only fixture owner, bound address, layout and signed update metadata is checked.
    pub primary_asset: UncheckedAccount,
    /// CHECK: Bound primary collateral source.
    pub primary_collateral: UncheckedAccount,
    /// CHECK: Bound guard asset source.
    pub guard_asset: UncheckedAccount,
    /// CHECK: Bound guard collateral source.
    pub guard_collateral: UncheckedAccount,
}

fn inactive(venue: &Venue, safety: &VenueSafety, listing: &MarketListing) -> Result<()> {
    super::account_trading::base_identity(venue, safety)?;
    require!(!safety.paused, ClearingError::Paused);
    require!(
        listing.schema_version == LISTING_SCHEMA
            && matches!(listing.status, LISTING_INACTIVE | LISTING_MAKERS_SEALED)
            && listing.quote_mint == venue.quote_mint,
        ClearingError::Profile
    );
    Ok(())
}

fn emit(
    venue: Address,
    index: &BorshAccount<ListingIndex>,
    events: &mut Payloads,
    authority: &AccountView,
) -> Result<()> {
    events.emit(
        &ListingIndexChanged {
            venue,
            slot: Clock::get()?.slot,
            index: *index.address(),
            listing: index.listing,
            sources: index.sources,
            source_sequences: index.source_sequences,
            sampled_at: index.sampled_at,
            deadline: index.deadline,
            reference: index.reference,
            lower: index.lower,
            upper: index.upper,
        },
        authority.clone(),
    )
}

pub fn bind(ctx: &mut Context<BindListingIndex>, events: &mut Payloads) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    inactive(&accounts.venue, &accounts.safety, &accounts.listing)?;
    require!(
        accounts.market.schema_version == SCHEMA_VERSION && accounts.market.index == 0,
        ClearingError::Profile
    );
    let [_, primary_key, _, guard_key] = accounts.market.oracle.sources;
    let primary = fixture_feed(accounts.primary_collateral.account(), primary_key)?;
    let guard = fixture_feed(accounts.guard_collateral.account(), guard_key)?;
    require!(
        primary.authority == accounts.listing.oracle_publisher
            && primary.authority != guard.authority
            && primary.feed_id == [2; 32]
            && guard.feed_id == [4; 32],
        ClearingError::OracleSource
    );
    let id = feed_id(&accounts.listing.symbol)?;
    let guard_asset = find_program_address(
        &[b"feed", guard.authority.as_ref(), &id],
        &oracle_fixture::ID,
    )
    .0;
    **accounts.listing_index = ListingIndex {
        schema_version: LISTING_SCHEMA,
        listing: *accounts.listing.address(),
        sources: [
            accounts.listing.oracle_feed,
            primary_key,
            guard_asset,
            guard_key,
        ],
        bump: ctx.bumps.listing_index,
        ..Default::default()
    };
    emit(
        *accounts.venue.address(),
        &accounts.listing_index,
        events,
        accounts.event_authority.account(),
    )
}

pub(crate) fn source_observation(
    listing: &MarketListing,
    sources: &[Address; 4],
    floors: [u64; 4],
    feeds: [&AccountView; 4],
    now: i64,
) -> Result<(Option<policy::Bounds>, [u64; 4])> {
    let mut sequences = [0; 4];
    let mut prices = [policy::Price {
        value: 0,
        confidence: 0,
        exponent: 0,
        published: 0,
    }; 4];
    for (position, source) in feeds.into_iter().enumerate() {
        let feed = fixture_feed(source, sources[position])?;
        require!(
            feed.value.verifier == oracle_fixture::ID
                && feed.value.level == 2
                && feed.sequence > 0
                && feed.sequence >= floors[position],
            ClearingError::OracleSource
        );
        sequences[position] = feed.sequence;
        prices[position] = policy::Price {
            value: feed.value.price,
            confidence: feed.value.confidence,
            exponent: feed.value.exponent,
            published: feed.value.published,
        };
    }
    let bounds = policy::market_bounds(
        listing.lots_per_unit,
        [prices[0], prices[1]],
        Some([prices[2], prices[3]]),
        now,
    )
    .ok();
    Ok((bounds, sequences))
}

pub fn observe(ctx: &mut Context<ObserveListingIndex>, events: &mut Payloads) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    inactive(&accounts.venue, &accounts.safety, &accounts.listing)?;
    let index = &mut accounts.listing_index;
    require!(
        index.schema_version == LISTING_SCHEMA,
        ClearingError::Profile
    );
    let feeds = [
        accounts.primary_asset.account(),
        accounts.primary_collateral.account(),
        accounts.guard_asset.account(),
        accounts.guard_collateral.account(),
    ];
    let now = Clock::get()?.unix_timestamp;
    let (bounds, sequences) = source_observation(
        &accounts.listing,
        &index.sources,
        index.source_sequences,
        feeds,
        now,
    )?;
    let bounds = bounds.ok_or(ClearingError::OraclePolicy)?;
    require!(
        bounds.normal
            && now < bounds.deadline
            && sequences != index.source_sequences
            && (index.sampled_at == 0
                || now
                    .checked_sub(index.sampled_at)
                    .is_some_and(|age| age >= policy::SAMPLE_INTERVAL)),
        ClearingError::OraclePolicy
    );
    index.sampled_at = now;
    index.source_sequences = sequences;
    index.deadline = bounds.deadline;
    index.reference = bounds.reference;
    index.lower = bounds.lower;
    index.upper = bounds.upper;
    emit(
        *accounts.venue.address(),
        index,
        events,
        accounts.event_authority.account(),
    )
}

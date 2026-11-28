//! Freeze the funded venue and all admitted markets at one clock. The original
//! membership and financial resources stay immutable until complete settlement.
use super::*;
use crate::engine::oracle;
use crate::events::ListedDefaultFrozen;
use crate::instructions::{listing_index, maker_liquidity::routes::listed_venue};
use anchor_lang::AccountDeserialize;
use default_plan_selection::market_indexed::{MEMBERS, WIDTH};
use solvency::listed::{funded_equity, Valuation};

pub(crate) const FREEZE: [u8; 8] = [35, 105, 92, 152, 26, 109, 109, 150];

fn listing_key(account: &AccountView, seeds: &[&[u8]]) -> Result<()> {
    let expected =
        create_program_address(seeds, &crate::ID).map_err(|_| ClearingError::Resolution)?;
    require!(
        *account.address() == expected && account.owner() == &crate::ID,
        ClearingError::Resolution
    );
    Ok(())
}

#[inline(never)]
fn listed_market(
    venue: &BorshAccount<Venue>,
    id: u16,
    accounts: &[AccountView],
    feeds: &ResolutionSources,
    clock: &Clock,
) -> Result<FrozenListedMarket> {
    let [listing_view, funding_view, book_view, primary, guard] = accounts else {
        return Err(ClearingError::Resolution.into());
    };
    let listing = MarketListing::try_deserialize(&mut &listing_view.try_borrow()?[..])?;
    let funding = Box::new(ListedFunding::try_deserialize(
        &mut &funding_view.try_borrow()?[..],
    )?);
    let book = ListedMarketBook::try_deserialize(&mut &book_view.try_borrow()?[..])?;
    let listing_address = listing_view.address();
    listing_key(
        listing_view,
        &[
            b"market-listing",
            venue.address().as_ref(),
            &id.to_le_bytes(),
            &[listing.bump],
        ],
    )?;
    listing_key(
        funding_view,
        &[b"listed-funding", listing_address.as_ref(), &[funding.bump]],
    )?;
    listing_key(
        book_view,
        &[b"listed-book", listing_address.as_ref(), &[book.bump]],
    )?;
    require!(
        listing.schema_version == LISTING_SCHEMA
            && listing.venue == *venue.address()
            && listing.quote_mint == venue.quote_mint
            && listing.market_id == id
            && listing.status == LISTING_QUALIFICATION
            && funding.schema_version == LISTING_SCHEMA
            && funding.listing == *listing_address
            && funding.values.observation_sequence > 0
            && book.schema_version == LISTING_SCHEMA
            && book.listing == *listing_address
            && book.insurance_carry < 4,
        ClearingError::Resolution
    );
    let market = funding.values.market(&listing);
    let (bounds, _) = listing_index::source_observation(
        &listing,
        &market.oracle.sources,
        market.oracle.source_sequences,
        [
            primary,
            feeds.primary_collateral.account(),
            guard,
            feeds.guard_collateral.account(),
        ],
        clock.unix_timestamp,
    )?;
    let reference = bounds.ok_or(ClearingError::OraclePolicy)?.reference;
    Ok(FrozenListedMarket {
        market: id,
        reference,
        funding: oracle::effective(2, &market, clock)?,
        gross_lots: book.gross_lots,
        settlement: book.settlement,
        insurance: book.insurance,
        fees: book.fees,
        insurance_carry: book.insurance_carry,
    })
}

#[inline(never)]
fn inline_markets(a: &mut FreezeListedDefault, clock: &Clock) -> Result<[FrozenListedMarket; 2]> {
    let identity = &mut *a.identity;
    let mut btc = Box::new(account_trading::market_view(&identity.btc)?);
    let mut eth = Box::new(account_trading::market_view(&identity.eth)?);
    let sources = &a.sources;
    let bounds = oracle::sources(
        &mut btc,
        &mut eth,
        [
            &sources.primary_btc,
            &sources.primary_collateral,
            &sources.guard_btc,
            &sources.guard_collateral,
            &sources.primary_eth,
            &sources.guard_eth,
        ],
        clock.unix_timestamp,
    )?;
    let mut frozen = [FrozenListedMarket::default(); 2];
    // The contiguous checkpoint instructions have folded all execution and fee lanes.
    for (index, (market, ledger)) in [
        (&*btc, &mut identity.btc_ledger),
        (&*eth, &mut identity.eth_ledger),
    ]
    .into_iter()
    .enumerate()
    {
        crate::market_fees::clean(ledger)?;
        require!(
            usize::from(market.index) == index
                && ledger.schema_version == SCHEMA_VERSION
                && ledger.insurance_fee_remainder < 4,
            ClearingError::Resolution
        );
        frozen[index] = FrozenListedMarket {
            market: u16::from(market.index),
            reference: bounds[index].ok_or(ClearingError::OraclePolicy)?.reference,
            funding: oracle::effective(2, market, clock)?,
            gross_lots: market.gross_lots,
            settlement: ledger.settlement,
            insurance: ledger.insurance,
            fees: ledger.fees,
            insurance_carry: ledger.insurance_fee_remainder,
        };
    }
    Ok(frozen)
}

pub(crate) fn freeze(
    ctx: &mut Context<FreezeListedDefault>,
    events: &mut crate::event_cpi::Payloads,
    safety_epoch: u64,
) -> Result<()> {
    let remaining = ctx.remaining_accounts()?;
    let clock = Clock::get()?;
    let a = &mut ctx.accounts;
    listed_venue::identity(&a.identity.venue, &a.identity.safety)?;
    let count = usize::from(a.directory.count);
    require!(
        safety_epoch == a.identity.safety.epoch
            && a.identity.safety.resolution_epoch == 0
            && a.registry.financial_count <= MEMBERS as u64
            && a.directory.schema_version == LISTING_SCHEMA
            && count > 0
            && count <= a.directory.markets.len()
            && count + MARKET_COUNT <= WIDTH
            && remaining.len() == count * 5,
        ClearingError::Resolution
    );
    let registry_hash = registry_hash(&a.registry)?;
    crate::instructions::account_membership::members::member(
        &a.members,
        &a.registry,
        a.target.address(),
        &a.target,
    )?;
    account_custody::vault_backed(&a.identity.custody, a.identity.vault.amount())?;
    let mut snapshot = Box::<ListedDefaultSnapshot>::default();
    snapshot.markets[..MARKET_COUNT].copy_from_slice(&inline_markets(a, &clock)?);
    let ids = &a.directory.markets[..count];
    require!(
        ids[0] >= MARKET_COUNT as u16
            && ids.windows(2).all(|pair| pair[0] < pair[1])
            && a.directory.markets[count..].iter().all(|&id| id == 0),
        ClearingError::Resolution
    );
    for (slot, (&id, views)) in ids.iter().zip(remaining.chunks_exact(5)).enumerate() {
        snapshot.markets[MARKET_COUNT + slot] =
            listed_market(&a.identity.venue, id, views, &a.sources, &clock)?;
    }
    let width = count + MARKET_COUNT;
    let values: Vec<_> = snapshot.markets[..width]
        .iter()
        .map(|m| Valuation {
            market: m.market,
            reference: m.reference,
            funding: m.funding,
        })
        .collect();
    let bytes = a.target.account().try_borrow()?;
    let directory = bytes
        .get(MARGIN_ALLOCATION..)
        .ok_or(ClearingError::Profile)?;
    require!(
        funded_equity(&a.target, directory, &values)?.can_default(),
        ClearingError::Resolution
    );
    drop(bytes);
    increment(&mut a.identity.venue.terms_epoch)?;
    increment(&mut a.identity.safety.epoch)?;
    increment(&mut a.identity.safety.resolution_epoch)?;
    a.identity.safety.mode = FROZEN;
    a.identity.safety.paused = true;
    a.identity.safety.recovery_since = 0;
    a.identity.safety.recovery_last = 0;
    snapshot.epoch = a.identity.safety.resolution_epoch;
    snapshot.safety_epoch = a.identity.safety.epoch;
    snapshot.terms_epoch = a.identity.venue.terms_epoch;
    snapshot.target = *a.target.address();
    snapshot.membership_epoch = a.registry.membership_epoch;
    snapshot.member_count = a.registry.financial_count;
    snapshot.registry_hash = registry_hash;
    snapshot.allocated_vault = a.identity.custody.allocated_vault;
    snapshot.frozen_at = clock.unix_timestamp;
    snapshot.width = width as u8;
    a.episode.schema_version = LISTING_SCHEMA;
    a.episode.venue = *a.identity.venue.address();
    a.episode.bump = ctx.bumps.episode;
    a.episode.snapshot = (*snapshot).clone();
    events.emit(
        &ListedDefaultFrozen {
            venue: a.episode.venue,
            slot: clock.slot,
            episode: *a.episode.address(),
            bump: a.episode.bump,
            snapshot: *snapshot,
        },
        a.event_authority.account().clone(),
    )
}
pub(crate) mod settlement;
pub(crate) const SETTLE: [u8; 8] = [132, 85, 222, 133, 57, 80, 88, 209];

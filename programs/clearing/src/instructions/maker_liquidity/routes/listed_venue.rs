//! The opt-in funded wider venue has its own admission boundary. Until broader
//! settlement qualifies, its profile rejects two-market payouts and default.
use super::*;
use crate::engine::{account, oracle};
use crate::event_cpi::Payloads;
use crate::instructions::account_cash::{listed::ListedMargin, Snapshot};
use financial_core::{
    fee_lanes::{classify, FeeCheckpoint, FeeLane, MarketFunds},
    margin::Risk,
    withdrawal::MarketWindow,
};

pub(crate) const FILL: [u8; 8] = [250, 20, 51, 83, 229, 130, 125, 143];
const CHECKPOINT: [u8; 8] = [234, 231, 222, 47, 209, 237, 138, 64];
const BASE_FUNDING: [u8; 8] = [32, 39, 131, 11, 127, 118, 35, 241];
const LISTED_FUNDING: [u8; 8] = [74, 221, 17, 23, 121, 23, 69, 210];

pub(crate) fn permits(instruction: [u8; 8]) -> bool {
    matches!(
        instruction,
        FILL | CHECKPOINT | BASE_FUNDING | LISTED_FUNDING
    )
}

pub(crate) fn identity(venue: &Venue, safety: &VenueSafety) -> Result<()> {
    require!(
        venue.schema_version == SCHEMA_VERSION
            && venue.profile_version == LISTED_VENUE_PROFILE
            && usize::from(venue.market_count) == MARKET_COUNT
            && venue.insurance_fee_share_bps == 2500
            && safety.schema_version == SCHEMA_VERSION
            && safety.mode == ACTIVE
            && !safety.paused,
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn begin(
    ctx: &mut Context<BeginListedQualification>,
    events: &mut Payloads,
) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let a = &mut ctx.accounts;
    trading::activated_identity(&a.venue, &a.safety)?;
    let listing = *a.listing.address();
    let venue = *a.venue.address();
    pricing::sealed_registry(&a.registry, venue, listing)?;
    require!(
        a.listing.schema_version == LISTING_SCHEMA
            && a.listing.status == LISTING_MAKERS_SEALED
            && usize::from(a.listing.market_id) >= MARKET_COUNT
            && a.listing.quote_mint == a.venue.quote_mint
            && a.funding.schema_version == LISTING_SCHEMA
            && a.funding.values.observation_sequence > 0
            && a.safety.resolution_epoch == 0,
        ClearingError::Profile
    );
    let clock = Clock::get()?;
    // An inactive observation cannot earn retroactive funding. Active trading
    // needs a new qualified observation at or after this transition.
    let mut market =
        funding::control_admitted_market(CUSTODY, &a.funding.values.market(&a.listing), &clock)?;
    increment(&mut market.observation_sequence)?;
    a.funding.values = ListedFundingValues::from(&market);
    a.listing.status = LISTING_QUALIFICATION;
    a.venue.profile_version = LISTED_VENUE_PROFILE;
    increment(&mut a.venue.terms_epoch)?;
    increment(&mut a.safety.epoch)?;
    let mut markets = [0; 6];
    markets[0] = a.listing.market_id;
    **a.directory = ListedVenue {
        schema_version: LISTING_SCHEMA,
        venue,
        markets,
        count: 1,
        bump: ctx.bumps.directory,
        ..Default::default()
    };
    **a.book = ListedMarketBook {
        schema_version: LISTING_SCHEMA,
        listing,
        bump: ctx.bumps.book,
        ..Default::default()
    };
    events.emit(
        &ListedVenueOpened {
            venue,
            slot: clock.slot,
            safety_epoch: a.safety.epoch,
            listing,
            market_id: a.listing.market_id,
            directory: *a.directory.address(),
            directory_bump: a.directory.bump,
            book: *a.book.address(),
            book_bump: a.book.bump,
            funding: *a.funding.address(),
            values: a.funding.values.clone(),
        },
        a.event_authority.account().clone(),
    )
}

#[inline(never)]
fn select(
    a: &mut ExecuteListedMarketOrder,
    args: &BestRouteIntent,
    clock: &Clock,
) -> Result<listed::SelectedRoute> {
    identity(&a.identity.venue, &a.identity.safety)?;
    args.guard
        .check(&a.identity.venue, &a.identity.safety, &a.trader)?;
    account::trade_authority(&a.trader, *a.actor.address(), clock.slot)?;
    require!(
        a.listing.status == LISTING_QUALIFICATION
            && a.directory.schema_version == LISTING_SCHEMA
            && a.book.schema_version == LISTING_SCHEMA
            && a.funding.schema_version == LISTING_SCHEMA
            && a.directory.count == 1
            && a.directory.markets[0] == a.listing.market_id,
        ClearingError::Profile
    );
    let base = Snapshot::optional(a.identity.markets(), clock)?;
    let trader = ListedMargin::load(&mut a.trader, None, &base, !args.reduce_only)?;
    let id = a.listing.market_id;
    let makers = [
        ListedMargin::load(&mut a.candidate_zero.zero_capital, Some(id), &base, true)?,
        ListedMargin::load(&mut a.candidate_one.one_capital, Some(id), &base, true)?,
        ListedMargin::load(&mut a.candidate_two.two_capital, Some(id), &base, true)?,
    ];
    let market = a.funding.values.market(&a.listing);
    oracle::action(&market, clock, !args.reduce_only)?;
    let funding = oracle::effective(2, &market, clock)?;
    let [funding_low, funding_high] = oracle::funding_bounds(2, &market, clock)?;
    let source = MarketWindow {
        market: id,
        current: Risk {
            lower: market.lower,
            upper: market.upper,
            funding,
        },
        funding_low,
        funding_high,
    };
    listed::select(
        &a.identity.venue,
        &a.listing,
        &a.registry,
        [
            a.candidate_zero.pricing(),
            a.candidate_one.pricing(),
            a.candidate_two.pricing(),
        ],
        &makers,
        &trader,
        &base,
        core::slice::from_ref(&source),
        market.reference_price,
        a.book.gross_lots,
        args,
    )
}

pub(crate) fn execute(
    ctx: &mut Context<ExecuteListedMarketOrder>,
    args: BestRouteIntent,
) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let clock = Clock::get()?;
    let selected = select(&mut ctx.accounts, &args, &clock)?;
    let mut filled = [false; 8];
    for leg in &selected.makers {
        filled[leg.index] = true;
    }
    let plan = crate::scoped_history::MakerAccess {
        filled,
        extras: 0,
        lane_slot: None,
        external_lane: None,
    };
    crate::scoped_history::run_selected_route(ctx, FILL, plan, |ctx, events| {
        commit(&mut ctx.accounts, selected, &args, &clock, events)
    })
}

#[inline(never)]
fn emit_margin(
    events: &mut Payloads,
    root: &BorshAccount<MarginAccount>,
    next: &ListedMargin,
    authority: &AccountView,
    slot: u64,
) -> Result<()> {
    use clearing_accounting::market_slots::storage::{HEADER_BYTES, RECORD_BYTES};
    let mut positions = vec![
        0;
        root.account()
            .data_len()
            .checked_sub(MARGIN_ALLOCATION)
            .ok_or(ClearingError::Profile)?
    ];
    crate::engine::checked(next.directory.write_listed_bytes(&mut positions))?;
    positions.truncate(HEADER_BYTES + RECORD_BYTES * next.directory.records().len());
    events.emit(
        &ListedMarginChanged {
            venue: root.venue,
            slot,
            margin: *root.address(),
            state: MarginAccountSnapshot::from(&**root),
            positions,
        },
        authority.clone(),
    )
}

#[inline(never)]
fn commit(
    a: &mut ExecuteListedMarketOrder,
    selected: listed::SelectedRoute,
    args: &BestRouteIntent,
    clock: &Clock,
    events: &mut Payloads,
) -> Result<()> {
    let authority = a.event_authority.account().clone();
    selected.trader.commit(&mut a.trader)?;
    emit_margin(events, &a.trader, &selected.trader, &authority, clock.slot)?;
    let mut legs = Vec::with_capacity(selected.makers.len());
    for leg in selected.makers {
        let (root, registration) = match leg.index {
            0 => a.candidate_zero.financial_accounts(),
            1 => a.candidate_one.financial_accounts(),
            2 => a.candidate_two.financial_accounts(),
            _ => return Err(ClearingError::MakerBinding.into()),
        };
        leg.margin.commit(root)?;
        consume(registration, &leg.quote)?;
        let request = &leg.quote.request;
        legs.push(crate::state::liquidity::ExecutedLeg {
            registration: *registration.address(),
            capital: *root.address(),
            instance: registration.instance,
            lots: request.lots,
            gross: leg.quote.gross,
            price_sequence: leg.quote.price_sequence,
            authority_epoch: request.authority_epoch,
            control_epoch: request.control_epoch,
            shape_epoch: request.shape_epoch,
            depth_epoch: request.depth_epoch,
            consumed_before: request.consumed,
            consumed_after: if request.side == 0 {
                registration.buy_consumed
            } else {
                registration.sell_consumed
            },
        });
        emit_margin(events, root, &leg.margin, &authority, clock.slot)?;
    }
    let lane = crate::engine::checked(
        FeeLane {
            collected: a.book.collected_fees,
        }
        .record(selected.allocation.fee),
    )?;
    let classified = crate::engine::checked(classify(
        FeeCheckpoint {
            classified: a.book.collected_fees,
            carry: a.book.insurance_carry,
        },
        MarketFunds {
            insurance: a.book.insurance,
            retained: a.book.fees,
        },
        &[lane],
    ))?;
    a.book.gross_lots = selected.gross_lots;
    a.book.collected_fees = classified.checkpoint.classified;
    a.book.insurance_carry = classified.checkpoint.carry;
    a.book.insurance = classified.funds.insurance;
    a.book.fees = classified.funds.retained;
    a.identity.materialize(clock)?;
    let mut market = a.funding.values.market(&a.listing);
    oracle::materialize(2, &mut market, clock)?;
    a.funding.values = ListedFundingValues::from(&market);
    events.emit(
        &ListedRouteFilled {
            venue: *a.identity.venue.address(),
            slot: clock.slot,
            listing: *a.listing.address(),
            trader: *a.trader.address(),
            side: args.side,
            lots: args.lots,
            gross: selected.allocation.gross,
            fee: selected.allocation.fee,
            gross_lots: a.book.gross_lots,
            insurance: a.book.insurance,
            retained_fees: a.book.fees,
            insurance_carry: a.book.insurance_carry,
            legs,
            funding: a.funding.values.clone(),
            inline_markets: a
                .identity
                .markets()
                .into_iter()
                .flatten()
                .map(MarketSnapshot::from)
                .collect(),
        },
        authority,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn widened_venue_refuses_inline_payout_even_for_an_empty_creditor_root() {
        let tag = |name: &str| -> [u8; 8] {
            let seed = format!("global:{name}");
            solana_sha256_hasher::hash(seed.as_bytes()).to_bytes()[..8]
                .try_into()
                .unwrap()
        };
        for name in [
            "execute_listed_market_order",
            "checkpoint_market",
            "publish_funding_report",
            "publish_listed_funding",
        ] {
            assert!(permits(tag(name)), "{name}");
        }
        for name in [
            "withdraw_funded_account",
            "transfer_account_cash",
            "execute_best_route",
            "begin_listed_qualification",
            "bind_indexed_default",
        ] {
            assert!(!permits(tag(name)), "{name}");
        }
    }
}

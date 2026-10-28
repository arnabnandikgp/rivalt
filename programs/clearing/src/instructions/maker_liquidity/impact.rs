//! Complete canonical sampling: every required maker is authenticated even when
//! its capacity is zero, and each positive quantity gets actual maker admission.
use super::{
    admission::MakerAdmission,
    pricing::{AuthenticatedCurve, CodeApprovalCache, View},
    *,
};
use crate::instructions::{account_trading, group_trading};
use crate::state::v4::{SampleInputV4, SampleLegV4};
use financial_core::{
    liquidity::{best_sample_pair, SAMPLE_ENTRIES, SAMPLE_STRIDE},
    oracle as policy,
};

pub(crate) struct Impact {
    pub quantity: u64,
    pub bid: u64,
    pub ask: u64,
    pub expiry_slot: u64,
    pub expiry_time: i64,
    pub bid_legs: Vec<SampleLegV4>,
    pub ask_legs: Vec<SampleLegV4>,
}

#[inline(never)]
pub(crate) fn sample(
    venue: &Account<VenueV3>,
    market: &Account<MarketV3>,
    registry: &Account<LiquidityRegistryV4>,
    views: &[View; 3],
    bounds: policy::Bounds,
    funding: i128,
    clock: &Clock,
    inputs: &mut [SampleInputV4; 3],
) -> Result<Impact> {
    require!(
        (10_000..=100_000).contains(&bounds.reference),
        ClearingError::OraclePolicy
    );
    let quantity = policy::REFERENCE_NOTIONAL.div_ceil(bounds.reference);
    let mut pricing_market = account_trading::market_view(market)?;
    pricing_market.reference_price = bounds.reference;
    pricing_market.lower = bounds.lower;
    pricing_market.upper = bounds.upper;
    let mut cache = CodeApprovalCache::default();
    let mut states = Vec::with_capacity(3);
    let mut admissions = Vec::with_capacity(3);
    let mut expiry_slot = u64::MAX;
    let mut expiry_time = i64::MAX;
    for (instance, view) in views.iter().enumerate() {
        require!(
            view.registration.instance as usize == instance
                && !views[..instance]
                    .iter()
                    .any(|other| other.capital.key() == view.capital.key()
                        || other.capital.id == view.capital.id),
            ClearingError::Alias
        );
        let state = view.authenticate(venue, market, registry, &mut cache)?;
        let (slot, time) = canonical::validate_publication(
            view.config.key(),
            &state.config,
            &state.price,
            clock.slot,
            clock.unix_timestamp,
        )
        .map_err(|_| error!(ClearingError::MakerQuote))?;
        expiry_slot = expiry_slot.min(slot);
        expiry_time = expiry_time.min(time);
        inputs[instance] = SampleInputV4 {
            registration: view.registration.key(),
            capital: view.capital.key(),
            authority_epoch: view.registration.authority_epoch,
            control_epoch: state.config.control_epoch,
            shape_epoch: state.config.shape_epoch,
            depth_epoch: view.registration.depth_epoch,
            price_sequence: state.price.sequence,
            buy_consumed: view.registration.buy_consumed,
            sell_consumed: view.registration.sell_consumed,
            expiry_slot: slot,
            expiry_time: time,
        };
        admissions.push(MakerAdmission::new(
            view.capital,
            &pricing_market,
            funding,
            clock.slot,
        )?);
        states.push(state);
    }
    // Allocate once. The SBF allocator does not reclaim ordinary dropped Vecs.
    // Zero entries encode unavailable quantities, leaving health gaps intact.
    let mut table = vec![0u64; SAMPLE_ENTRIES];
    let mut totals = [0; 2];
    let mut legs = [Vec::new(), Vec::new()];
    for side in 0..=1u8 {
        let (gross, selected) = sample_side(
            venue,
            market,
            views,
            &states,
            &admissions,
            quantity,
            side,
            clock,
            &mut table,
        )?;
        totals[usize::from(side)] = gross;
        legs[usize::from(side)] = selected;
    }
    require!(
        totals[0] >= totals[1] && totals[1] > 0,
        ClearingError::OraclePolicy
    );
    let [ask_legs, bid_legs] = legs;
    Ok(Impact {
        quantity,
        bid: totals[1],
        ask: totals[0],
        expiry_slot,
        expiry_time,
        bid_legs,
        ask_legs,
    })
}

// Separate the search/CPI frame from configuration decoding and root preparation.
// This keeps the SBF 4 KiB frame bound without extra heap allocations per quantity.
#[inline(never)]
fn sample_side(
    venue: &Account<VenueV3>,
    market: &Account<MarketV3>,
    views: &[View; 3],
    states: &[AuthenticatedCurve],
    admissions: &[MakerAdmission],
    quantity: u64,
    side: u8,
    clock: &Clock,
    table: &mut [u64],
) -> Result<(u64, Vec<SampleLegV4>)> {
    let mut selected_legs = Vec::with_capacity(2);
    table.fill(0);
    let mut first_quotes = [0u64; 3];
    for instance in 0..3 {
        let view = &views[instance];
        let state = &states[instance];
        let request = view.request(venue, market, state, side, 1);
        let mut ladder = canonical::QuoteLadderV4::new(
            &state.config.shape,
            state.price.anchor,
            side,
            request.inventory,
            request.consumed,
        )
        .map_err(|_| error!(ClearingError::MakerQuote))?;
        if ladder.capacity() == 0 {
            continue;
        }
        first_quotes[instance] = view.quote(state, &request, clock)?.gross;
        for lots in 1..=quantity.min(ladder.capacity()) {
            let gross = match ladder.next_quote() {
                Ok(Some((gross, _))) => gross,
                Ok(None) => break,
                // The first marginal was authenticated by CPI above. A
                // later global price-bound failure invalidates that and all
                // later prefixes, while earlier quantities remain eligible.
                Err(maker_interface::QuoteError::Bounds) => break,
                Err(_) => return err!(ClearingError::MakerQuote),
            };
            if lots == 1 {
                require!(
                    gross == first_quotes[instance],
                    ClearingError::MakerResponse
                );
            }
            if admissions[instance].admits(side, lots, gross) {
                table[instance * SAMPLE_STRIDE + lots as usize] = gross;
            }
        }
    }
    let selected = group_trading::checked(best_sample_pair(&table, quantity, side))?
        .ok_or(ClearingError::MakerCapital)?;
    let mut invoked = 0u64;
    for (instance, lots) in selected.quantities.into_iter().enumerate() {
        if lots == 0 {
            continue;
        }
        let gross = if lots == 1 {
            first_quotes[instance]
        } else {
            views[instance]
                .quote(
                    &states[instance],
                    &views[instance].request(venue, market, &states[instance], side, lots),
                    clock,
                )?
                .gross
        };
        require!(
            gross == table[instance * SAMPLE_STRIDE + lots as usize],
            ClearingError::MakerResponse
        );
        require!(
            admissions[instance].selected_admits(side, lots, gross),
            ClearingError::MakerCapital
        );
        invoked = invoked
            .checked_add(gross)
            .ok_or(ClearingError::Arithmetic)?;
        selected_legs.push(SampleLegV4 {
            instance: instance as u8,
            lots,
            gross,
        });
    }
    require!(invoked == selected.gross, ClearingError::MakerResponse);
    Ok((selected.gross, selected_legs))
}

//! D74 funding samples published liquidity, not financially admitted fills.
//! Authenticate every required maker, including those with zero declared capacity.
use super::{
    pricing::{AuthenticatedCurve, CodeApprovalCache, View},
    *,
};
use crate::instructions::group_trading;
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
    clock: &Clock,
    inputs: &mut [SampleInputV4; 3],
) -> Result<Impact> {
    require!(
        (10_000..=100_000).contains(&bounds.reference),
        ClearingError::OraclePolicy
    );
    let quantity = policy::REFERENCE_NOTIONAL.div_ceil(bounds.reference);
    let prepared = prepare_inputs(venue, market, registry, views, clock, inputs)?;
    // Allocate once. The SBF allocator does not reclaim ordinary dropped Vecs.
    // Zero entries encode unavailable or out-of-band published quantities.
    let mut table = vec![0u64; SAMPLE_ENTRIES];
    let mut totals = [0; 2];
    let mut legs = [Vec::new(), Vec::new()];
    for side in 0..=1u8 {
        let (gross, selected) = sample_side(
            venue,
            market,
            views,
            &prepared.states,
            bounds.reference,
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
        expiry_slot: prepared.expiry_slot,
        expiry_time: prepared.expiry_time,
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
    reference: u64,
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
        let start = instance * SAMPLE_STRIDE;
        let first = published_quotes(
            &mut ladder,
            reference,
            quantity,
            &mut table[start..start + SAMPLE_STRIDE],
        )?;
        require!(
            first == first_quotes[instance],
            ClearingError::MakerResponse
        );
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

/// Only curve depth/inventory and price bounds determine sampling eligibility.
/// No cash, claims, funding checkpoints, orders or margin requirements are inputs.
fn published_quotes(
    ladder: &mut canonical::QuoteLadderV4<'_>,
    reference: u64,
    quantity: u64,
    row: &mut [u64],
) -> Result<u64> {
    require!(
        row.len() == SAMPLE_STRIDE
            && (1..SAMPLE_STRIDE as u64).contains(&quantity)
            && (10_000..=100_000).contains(&reference),
        ClearingError::OraclePolicy
    );
    let mut first = 0;
    for lots in 1..=quantity.min(ladder.capacity()) {
        let gross = match ladder.next_quote() {
            Ok(Some((gross, _))) => gross,
            Ok(None) => break,
            // A global marginal bound invalidates this and later prefixes.
            Err(maker_interface::QuoteError::Bounds) => break,
            Err(_) => return err!(ClearingError::MakerQuote),
        };
        if lots == 1 {
            first = gross;
        }
        // Preserve the independent 90–110% index price band. This checks the
        // published price, not the maker's ability to finance a hypothetical fill.
        let notional = lots
            .checked_mul(reference)
            .ok_or(ClearingError::Arithmetic)?;
        let scaled = gross.checked_mul(10).ok_or(ClearingError::Arithmetic)?;
        if scaled >= notional.checked_mul(9).ok_or(ClearingError::Arithmetic)?
            && scaled <= notional.checked_mul(11).ok_or(ClearingError::Arithmetic)?
        {
            row[lots as usize] = gross;
        }
    }
    Ok(first)
}

struct PreparedInputs {
    states: Vec<AuthenticatedCurve>,
    expiry_slot: u64,
    expiry_time: i64,
}

#[inline(never)]
fn prepare_inputs(
    venue: &Account<VenueV3>,
    market: &Account<MarketV3>,
    registry: &Account<LiquidityRegistryV4>,
    views: &[View; 3],
    clock: &Clock,
    inputs: &mut [SampleInputV4; 3],
) -> Result<PreparedInputs> {
    let mut cache = CodeApprovalCache::default();
    let mut states = Vec::with_capacity(3);
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
        states.push(state);
    }
    Ok(PreparedInputs {
        states,
        expiry_slot,
        expiry_time,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(offset: u64) -> canonical::ShapeV4 {
        let mut shape = canonical::ShapeV4 {
            mode: 1,
            ttl_slots: 150,
            skew_step: 512,
            long_cap: 600,
            short_cap: 600,
            bid_count: 1,
            ask_count: 1,
            ..Default::default()
        };
        shape.bids[0] = canonical::RegionV4 {
            end_lots: 600,
            offset,
            slope: 0,
        };
        shape.asks[0] = shape.bids[0];
        shape
    }

    #[test]
    fn published_depth_survives_insufficient_margin_but_execution_does_not() {
        let shape = shape(10);
        let mut table = vec![0; SAMPLE_ENTRIES];
        let mut ladder = canonical::QuoteLadderV4::new(&shape, 10_000, 0, 0, 0).unwrap();
        published_quotes(&mut ladder, 10_000, 600, &mut table[..SAMPLE_STRIDE]).unwrap();
        let selected = best_sample_pair(&table, 600, 0).unwrap().unwrap();
        assert_eq!(selected.quantities, [600, 0, 0]);
        assert_eq!(selected.gross, 6_006_000);
        // Literal trade expectation: zero collateral cannot support a new short
        // requiring 600,000 atoms of IM; 6,000 unpaid profit is not margin credit.
        let empty = financial_core::Participant::default();
        let filled = empty.quoted_fill(1, 600, 6_006_000, 0).unwrap();
        assert_eq!(filled.risk_equity(10_000, 10_000, 0).unwrap(), 0);
        assert_eq!(
            filled.margin(10_000, financial_core::IM_BPS).unwrap(),
            600_000
        );
        assert!(filled.admissible(10_000, 10_000, 0).is_err());
    }

    #[test]
    fn published_sampling_keeps_index_bands_consumption_and_reduce_only_caps() {
        for (offset, eligible) in [(1000, true), (1001, false)] {
            let shape = shape(offset);
            for side in 0..=1 {
                let mut row = vec![0; SAMPLE_STRIDE];
                let mut ladder = canonical::QuoteLadderV4::new(&shape, 10_000, side, 0, 0).unwrap();
                published_quotes(&mut ladder, 10_000, 600, &mut row).unwrap();
                assert_eq!(row[600] != 0, eligible);
            }
        }
        let mut shape = shape(10);
        let mut row = vec![0; SAMPLE_STRIDE];
        let mut ladder = canonical::QuoteLadderV4::new(&shape, 10_000, 0, 0, 599).unwrap();
        published_quotes(&mut ladder, 10_000, 600, &mut row).unwrap();
        assert_eq!(row[1], 10010);
        assert!(row[2..].iter().all(|gross| *gross == 0));
        shape.mode = 3;
        row.fill(0);
        let mut ladder = canonical::QuoteLadderV4::new(&shape, 10_000, 0, 2, 0).unwrap();
        published_quotes(&mut ladder, 10_000, 600, &mut row).unwrap();
        assert_eq!(row[2], 20020);
        assert_eq!(row[3], 0);
    }
}

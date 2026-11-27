//! The same standing-quote search as the base-market route, with inventory and
//! admission taken from the listed positions of the actual funded participants.
use super::{market_order::SelectionError, *};
use crate::instructions::account_cash::{listed::ListedMargin, Snapshot};
use financial_core::{route, withdrawal::MarketWindow};
use maker_interface::{canonical::MakerQuoteResponse, routing};

pub(crate) struct SelectedLeg {
    pub index: usize,
    pub margin: ListedMargin,
    pub quote: MakerQuoteResponse,
}

pub(crate) struct SelectedRoute {
    pub trader: ListedMargin,
    pub makers: Vec<SelectedLeg>,
    pub allocation: routing::Allocation,
    pub gross_lots: u64,
}

struct Candidates {
    trader: ListedMargin,
    makers: Vec<(usize, ListedMargin)>,
    gross_lots: u64,
}

struct Book<'a> {
    trader: &'a ListedMargin,
    makers: &'a [ListedMargin; 3],
    base: &'a Snapshot,
    trader_windows: &'a [MarketWindow],
    selected: &'a MarketWindow,
    gross_lots: u64,
}

impl Book<'_> {
    fn candidate(&self, side: u8, allocation: &routing::Allocation) -> Result<Candidates> {
        let market = self.selected.market;
        let trader = self.trader.participant(market)?;
        let mut makers = Vec::new();
        let mut amounts = Vec::new();
        let mut indexes = Vec::new();
        for (index, lots) in allocation.lots.into_iter().enumerate() {
            if lots > 0 {
                indexes.push(index);
                makers.push(self.makers[index].participant(market)?);
                amounts.push((lots, allocation.amounts[index]));
            }
        }
        let (filled_trader, filled_makers, fee) = crate::engine::checked(route::candidate(
            trader,
            &makers,
            &amounts,
            side,
            self.selected.current.funding,
            0,
        ))?;
        require!(fee == allocation.fee, ClearingError::Reconciliation);
        let total_lots = |positions: &[financial_core::Participant],
                          trader: financial_core::Participant| {
            positions
                .iter()
                .try_fold(trader.lots.unsigned_abs(), |sum, p| {
                    sum.checked_add(p.lots.unsigned_abs())
                })
                .ok_or(ClearingError::Arithmetic)
        };
        let gross_lots = self
            .gross_lots
            .checked_sub(total_lots(&makers, trader)?)
            .ok_or(ClearingError::Reconciliation)?
            .checked_add(total_lots(&filled_makers, filled_trader)?)
            .ok_or(ClearingError::Arithmetic)?;
        require!(
            gross_lots <= financial_core::MAX_GROSS_LOTS,
            ClearingError::RouteHealth
        );
        let mut trader = self.trader.clone();
        trader.admit_fill(
            self.base,
            market,
            filled_trader,
            allocation.gross,
            self.trader_windows,
        )?;
        crate::instructions::account_cash::advance(&mut trader.root)?;
        let mut candidates = Vec::with_capacity(indexes.len());
        for (index, filled) in indexes.into_iter().zip(filled_makers) {
            let mut maker = self.makers[index].clone();
            maker.admit_fill(
                self.base,
                market,
                filled,
                allocation.amounts[index],
                core::slice::from_ref(self.selected),
            )?;
            crate::engine::advance(&mut maker.root)?;
            candidates.push((index, maker));
        }
        Ok(Candidates {
            trader,
            makers: candidates,
            gross_lots,
        })
    }
}

/// The context binds listing/funding and every source PDA and checks the actor
/// and signed guard. Verify the directory and identity of *all* locked candidates
/// before search. A quarantined maker cannot substitute a different account.
#[inline(never)]
pub(crate) fn select(
    venue: &BorshAccount<Venue>,
    listing: &BorshAccount<MarketListing>,
    registry: &BorshAccount<LiquidityRegistry>,
    views: [pricing::View; 3],
    makers: &[ListedMargin; 3],
    trader: &ListedMargin,
    base: &Snapshot,
    trader_windows: &[MarketWindow],
    reference: u64,
    gross_lots: u64,
    args: &BestRouteIntent,
) -> Result<SelectedRoute> {
    let market = listing.market_id;
    let clock = &base.clock;
    let selected = trader_windows
        .iter()
        .find(|window| window.market == market)
        .ok_or(ClearingError::OracleSource)?;
    require!(
        args.side <= 1
            && (1..=crate::constants::routes::MAX_ROUTE_LOTS).contains(&args.lots)
            && args.domain == venue.domain
            && args.terms_epoch == 1
            && args.config_epoch == 1
            && clock.slot >= args.start_slot
            && clock.slot < args.expiry_slot
            && args
                .expiry_slot
                .checked_sub(args.start_slot)
                .is_some_and(|v| v <= 150),
        ClearingError::RouteIntent
    );
    // Listed market orders currently admit strictly healthy post-fill exposure.
    // A specialized deficit-reducing route needs its own maintenance-progress check.
    require!(!args.reduce_only, ClearingError::RouteIntent);
    if let Some(generation) = args.generation {
        require!(
            trader.participant(market)?.generation == generation,
            ClearingError::RouteIntent
        );
    }
    let mut cache = pricing::CodeApprovalCache::default();
    let mut states: Vec<Option<pricing::AuthenticatedCurve>> = (0..3).map(|_| None).collect();
    for (index, view) in views.iter().enumerate() {
        view.bind_listing(venue, listing, registry)?;
        require!(
            usize::from(view.registration.instance) == index
                && view.capital.id == makers[index].root.id
                && views[..index]
                    .iter()
                    .all(|other| other.capital.address() != view.capital.address()
                        && other.capital.id != view.capital.id),
            ClearingError::MakerBinding
        );
        if view.registration.quarantined {
            continue;
        }
        let state = match view.read_approved_curve(venue, *listing.address(), &mut cache) {
            Ok(state) => state,
            Err(error) if error == ProgramError::from(ClearingError::MakerUpgrade) => continue,
            Err(error) => return Err(error),
        };
        let epochs = &args.maker_epochs[index];
        require!(
            epochs.authority == view.registration.authority_epoch
                && epochs.depth == view.registration.depth_epoch
                && epochs.control == state.config.control_epoch
                && epochs.shape == state.config.shape_epoch,
            ClearingError::MakerEpoch
        );
        if view.capital.owner == trader.root.owner
            || view.capital.id == trader.root.id
            || canonical::validate_standing_publication(
                *view.config.address(),
                &state.config,
                &state.price,
                clock.slot,
                clock.unix_timestamp,
            )
            .is_err()
        {
            continue;
        }
        states[index] = Some(state);
    }
    let mut curves = [None; 3];
    for (index, state) in states.iter().enumerate() {
        let Some(state) = state else { continue };
        let view = &views[index];
        let inventory = makers[index].participant(market)?.lots;
        let request =
            view.inventory_request(venue, *listing.address(), inventory, state, args.side, 1);
        curves[index] = Some(
            canonical::ExecutionCurve::new(
                &state.config.shape,
                state.price.anchor,
                args.side,
                inventory,
                request.consumed,
            )
            .and_then(|curve| curve.with_funded_cash(view.capital.cash, selected.current.upper))
            .map_err(|_| ClearingError::MakerQuote)?,
        );
    }
    let book = Book {
        trader,
        makers,
        base,
        trader_windows,
        selected,
        gross_lots,
    };
    let order = routing::Order {
        side: args.side,
        lots: args.lots,
        reference,
        max_fee: args.max_fee,
        all_in_limit: args.all_in_limit,
    };
    let mut winner = None;
    let allocation = routing::select_for_clearing(order, curves, |allocation| {
        match book.candidate(args.side, allocation) {
            Ok(candidate) => {
                winner = Some(candidate);
                Ok(true)
            }
            Err(error)
                if [
                    ClearingError::Arithmetic,
                    ClearingError::RouteHealth,
                    ClearingError::ExitCohort,
                ]
                .into_iter()
                .any(|e| ProgramError::from(e) == error) =>
            {
                Ok(false)
            }
            Err(error) => Err(SelectionError(error)),
        }
    })
    .map_err(|error| error.0)?
    .ok_or(ClearingError::RouteHealth)?;
    let winner = winner.ok_or(ClearingError::RouteHealth)?;
    let mut legs = Vec::with_capacity(winner.makers.len());
    for (index, margin) in winner.makers {
        let view = &views[index];
        let state = states[index].as_ref().ok_or(ClearingError::MakerBinding)?;
        let mut request = view.inventory_request(
            venue,
            *listing.address(),
            makers[index].participant(market)?.lots,
            state,
            args.side,
            allocation.lots[index],
        );
        request.version = canonical::STANDING_TRADE_VERSION;
        let quote = view.quote(state, &request, clock)?;
        require!(
            quote.gross == allocation.amounts[index],
            ClearingError::MakerResponse
        );
        legs.push(SelectedLeg {
            index,
            margin,
            quote,
        });
    }
    Ok(SelectedRoute {
        trader: winner.trader,
        gross_lots: winner.gross_lots,
        makers: legs,
        allocation,
    })
}

#[cfg(test)]
mod tests;

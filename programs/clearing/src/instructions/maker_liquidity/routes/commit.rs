use super::*;
use crate::state::liquidity::ExecutedLeg;

#[inline(never)]
pub(super) fn apply(
    accounts: &mut RouteAccounts<'_>,
    events: &mut crate::event_cpi::Payloads,
    intent: &RouteIntent,
    order_index: Option<usize>,
    clock: &Clock,
    next: &candidates::Candidate,
    quotes: &[canonical::MakerQuoteResponse],
    path: RoutePath,
    mut separate_lane: Option<&mut BorshAccount<MakerRegistration>>,
) -> Result<()> {
    require!(accounts.first_registration.instance < 3 || separate_lane.is_some(), ClearingError::MakerBinding);
    require!(quotes.len() == next.makers.len()
        && quotes.len() == 1 + usize::from(accounts.second_capital.is_some()) + accounts.additional.len()
        && (accounts.additional.is_empty() || cfg!(feature = "wide-atomic-routes") && path == RoutePath::Serial),
        ClearingError::RouteIntent);
    let identity = &mut accounts.identity;
    let cash_before = u128::from(identity.trader.cash)
        + accounts.additional.iter().map(|(capital,_)|u128::from(capital.cash)).sum::<u128>()
        + u128::from(accounts.first_capital.cash)
        + accounts
            .second_capital
            .as_ref()
            .map_or(0, |capital| u128::from(capital.cash));
    let cash_after = u128::from(next.trader.cash)
        + next
            .makers
            .iter()
            .map(|capital| u128::from(capital.cash))
            .sum::<u128>();
    require!(
        cash_before == cash_after + u128::from(next.fee),
        ClearingError::Reconciliation
    );
    let mut executed = Vec::with_capacity(quotes.len());
    let leg = |registration: &BorshAccount<MakerRegistration>,
               capital: Address,
               quote: &canonical::MakerQuoteResponse| ExecutedLeg {
        registration: registration.address().to_owned(),
        capital,
        instance: registration.instance,
        lots: quote.request.lots,
        gross: quote.gross,
        price_sequence: quote.price_sequence,
        authority_epoch: quote.request.authority_epoch,
        control_epoch: quote.request.control_epoch,
        shape_epoch: quote.request.shape_epoch,
        depth_epoch: quote.request.depth_epoch,
        consumed_before: quote.request.consumed,
        consumed_after: if intent.side == 0 {
            registration.buy_consumed
        } else {
            registration.sell_consumed
        },
    };
    #[cfg(feature = "profit-attribution-qualification")]
    {
        let market = usize::from(identity.market.index);
        crate::profit_attribution::fill(&mut identity.trader, market, next.trader.positions[market].lots, next.gross)?;
        crate::profit_attribution::fill(&mut accounts.first_capital, market, next.makers[0].positions[market].lots, quotes[0].gross)?;
        if let Some(second) = accounts.second_capital.as_deref_mut() {
            crate::profit_attribution::fill(second, market, next.makers[1].positions[market].lots, quotes[1].gross)?;
        }
    }
    #[cfg(feature="read-only-route-ledger")]
    let local_fee = if path == RoutePath::ReadOnlyLedger {
        let roots = std::iter::once((&**identity.trader, next.trader.as_ref()))
            .chain(std::iter::once((&**accounts.first_capital, &next.makers[0])))
            .chain(accounts.second_capital.as_deref().zip(next.makers.get(1)).map(|(old,new)| (&**old,new)));
        Some(crate::ledger_lane::record(identity.ledger, identity.safety, separate_lane.as_deref_mut().unwrap_or(accounts.first_registration), roots, next.fee)?)
    } else { None };
    consume(&mut accounts.first_registration, &quotes[0])?;
    executed.push(leg(
        &accounts.first_registration,
        accounts.first_capital.address().to_owned(),
        &quotes[0],
    ));
    if path != RoutePath::ReadOnlyLedger { identity.maintain_root(&accounts.first_capital, &next.makers[0])?; }
    trading::commit_root(&mut accounts.first_capital, &next.makers[0])?;
    if quotes.len() >= 2 {
        let registration = accounts.second_registration.as_deref_mut().unwrap();
        let capital = accounts.second_capital.as_deref_mut().unwrap();
        consume(registration, &quotes[1])?;
        executed.push(leg(registration, capital.address().to_owned(), &quotes[1]));
        if path != RoutePath::ReadOnlyLedger { identity.maintain_root(capital, &next.makers[1])?; }
        trading::commit_root(capital, &next.makers[1])?;
    }
    for (index,(capital,registration)) in accounts.additional.iter_mut().enumerate() {
        let quote = &quotes[index + 2];
        let after = &next.makers[index + 2];
        #[cfg(feature = "profit-attribution-qualification")]
        {
            let market = usize::from(identity.market.index);
            crate::profit_attribution::fill(capital, market, after.positions[market].lots, quote.gross)?;
        }
        consume(registration, quote)?;
        executed.push(leg(registration,*capital.address(),quote));
        identity.maintain_root(capital,after)?;
        trading::commit_root(capital,after)?;
    }
    let order = order_index.map(|index| identity.trader.book.orders[index].order);
    if path != RoutePath::ReadOnlyLedger { identity.maintain_trader(&next.trader)?; }
    trading::commit_root(&mut identity.trader, &next.trader)?;
    if path != RoutePath::Serial {
        #[cfg(feature = "read-only-route-market")]
        crate::market_capacity::record_local(identity.market, separate_lane.as_deref_mut().unwrap_or(accounts.first_registration), next.position_delta)?;
        #[cfg(not(feature = "read-only-route-market"))]
        return Err(ClearingError::Profile.into());
    } else {
        #[cfg(feature = "bounded-market-read")]
        crate::market_capacity::record(&mut identity.market, separate_lane.as_deref_mut().unwrap_or(accounts.first_registration), next.gross_lots, next.position_delta)?;
        identity.market.gross_lots = next.gross_lots;
        trading::materialize_optional(
            [
                Some(&mut identity.market),
                identity
                    .other_market
                    .as_deref_mut()
                    .map(|market| &mut **market),
            ],
            clock,
        )?;
    }
    #[cfg(feature="checked-funding-prefix")]
    {
        crate::market_funding::selected(&identity.market, separate_lane.as_deref_mut().unwrap_or(accounts.first_registration), clock)?;
        if let Some(sibling) = identity.other_market.as_deref_mut() {
            crate::market_funding::canonical(sibling, clock)?;
        }
    }
    #[cfg(not(feature="aggregate-fee-qualification"))]
    let fee_detail = {
        let (insurance, retained, before) = trading::split_fee(&mut identity.ledger, next.fee)?;
        (insurance, retained, before, identity.ledger.insurance_fee_remainder)
    };
    #[cfg(feature="read-only-route-ledger")]
    let fee_detail = match local_fee { Some(detail) => detail, None => crate::market_fees::escrow(identity.ledger,separate_lane.as_deref_mut().unwrap_or(accounts.first_registration),next.fee)? };
    #[cfg(all(feature="aggregate-fee-qualification",not(feature="read-only-route-ledger")))]
    let fee_detail = crate::market_fees::escrow(&mut identity.ledger,&mut accounts.first_registration,next.fee)?;

    let progress = if path != RoutePath::Serial {
        let funded = crate::engine::oracle::effective(crate::state::accounts::ACTIVE, identity.market, clock)?;
        Some((clock.unix_timestamp, funded, path))
    } else { None };
    emit(
        events,
        accounts,
        intent,
        order,
        next.gross,
        next.fee,
        fee_detail,
        clock.slot,
        executed,
        progress,
    )
}

#[cfg(not(feature="aggregate-fee-qualification"))]
type FeeDetail = (u64,u64,u8,u8);
#[cfg(feature="aggregate-fee-qualification")]
type FeeDetail = (u128,u64);

/// Wire-identical to the selected route event. Borrow full roots/registrations so
/// event serialization does not allocate multiple full order-book copies.
#[derive(AnchorSerialize)]
pub(super) struct RouteEventView<'a> {
    pub venue: Address,
    pub slot: u64,
    pub market: Address,
    pub market_state: &'a Market,
    pub other_market_state: Option<&'a Market>,
    pub nonce: u64,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub fee_detail: FeeDetail,
    pub ledger: crate::events::MarketLedgerSnapshot,
    pub other_ledger: Option<crate::events::MarketLedgerSnapshot>,
    pub order_id: u64,
    pub order_version: u64,
    pub root_states: Vec<&'a MarginAccount>,
    pub maker_states: Vec<&'a MakerRegistration>,
    pub legs: Vec<ExecutedLeg>,
}

#[inline(never)]
fn emit(
    events: &mut crate::event_cpi::Payloads,
    accounts: &RouteAccounts<'_>,
    intent: &RouteIntent,
    order: Option<crate::state::OrderRecord>,
    gross: u64,
    fee: u64,
    fee_detail: FeeDetail,
    slot: u64,
    legs: Vec<ExecutedLeg>,
    progress: Option<(i64,i128,RoutePath)>,
) -> Result<()> {
    let identity = &accounts.identity;
    let mut roots: Vec<&MarginAccount> = vec![&identity.trader, &accounts.first_capital];
    let mut makers: Vec<&MakerRegistration> = vec![&accounts.first_registration];
    if legs.len() >= 2 {
        roots.push(accounts.second_capital.as_deref().unwrap());
        makers.push(accounts.second_registration.as_deref().unwrap());
    }
    for (capital,registration) in &accounts.additional {
        roots.push(capital);
        makers.push(registration);
    }
    let event = RouteEventView {
        venue: identity.venue.address().to_owned(),

        slot,
        market: identity.market.address().to_owned(),
        market_state: &identity.market,
        other_market_state: identity.other_market.as_deref().map(|market| &**market),
        nonce: intent.nonce,
        side: intent.side,
        lots: intent.lots,
        gross_quote: gross,
        fee,
        fee_detail,
        ledger: crate::instructions::account_custody::ledger_snapshot(&identity.ledger),
        other_ledger: identity
            .other_ledger
            .as_deref()
            .map(crate::instructions::account_custody::ledger_snapshot),
        order_id: order.map(|order| order.id).unwrap_or(0),
        order_version: order.map(|order| order.version).unwrap_or(0),
        root_states: roots,
        maker_states: makers,
        legs,
    };
    if let Some((through, index, path)) = progress {
        #[cfg(feature = "read-only-route-market")]
        {
            #[derive(AnchorSerialize)]
            struct LaneView<'a> { route: &'a RouteEventView<'a>, through: i64, index: i128 }
            if path == RoutePath::ReadOnlyLedger {
                return events.emit_borrowed::<crate::events::LedgerLaneFilled, _>(
                    &LaneView { route: &event, through, index }, accounts.event_authority.clone());
            }
            return events.emit_borrowed::<crate::events::MarketLaneFilled, _>(
                &LaneView { route: &event, through, index }, accounts.event_authority.clone());
        }
        #[cfg(not(feature = "read-only-route-market"))]
        { let _ = (through, index, path); return Err(ClearingError::Profile.into()); }
    }
    #[cfg(not(feature="aggregate-fee-qualification"))]
    type RouteEvent = crate::events::LiquidityRouteExecuted;
    #[cfg(feature="aggregate-fee-qualification")]
    type RouteEvent = crate::events::LiquidityRouteFeeRecorded;
    events.emit_borrowed::<RouteEvent, _>(
        &event,
        accounts.event_authority.clone(),
    )
}

use super::*;
use crate::state::liquidity::ExecutedLeg;

#[inline(never)]
pub(super) fn apply(
    accounts: &mut ExecuteLiquidityRoute,
    events: &mut crate::event_cpi::Payloads,
    intent: &RouteIntent,
    order_index: Option<usize>,
    clock: &Clock,
    next: &candidates::Candidate,
    quotes: &[canonical::MakerQuoteResponse],
) -> Result<()> {
    let cash_before = u128::from(accounts.identity.trader.cash)
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
    let leg = |registration: &Account<MakerRegistration>,
               capital: Pubkey,
               quote: &canonical::MakerQuoteResponse| ExecutedLeg {
        registration: registration.key(),
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
    consume(&mut accounts.first_registration, &quotes[0])?;
    executed.push(leg(
        &accounts.first_registration,
        accounts.first_capital.key(),
        &quotes[0],
    ));
    let previous = accounts.first_capital.positions;
    trading::commit_root(&mut accounts.first_capital, &next.makers[0])?;
    accounts
        .identity
        .invalidate_positions(previous, accounts.first_capital.positions)?;
    if quotes.len() == 2 {
        let registration = accounts.second_registration.as_deref_mut().unwrap();
        let capital = accounts.second_capital.as_deref_mut().unwrap();
        consume(registration, &quotes[1])?;
        executed.push(leg(registration, capital.key(), &quotes[1]));
        let previous = capital.positions;
        trading::commit_root(capital, &next.makers[1])?;
        accounts
            .identity
            .invalidate_positions(previous, capital.positions)?;
    }
    let order = order_index.map(|index| accounts.identity.trader.book.orders[index].order);
    let previous = accounts.identity.trader.positions;
    trading::commit_root(&mut accounts.identity.trader, &next.trader)?;
    accounts
        .identity
        .invalidate_positions(previous, accounts.identity.trader.positions)?;
    accounts.identity.market.gross_lots = next.gross_lots;
    trading::materialize_optional(
        [
            Some(&mut accounts.identity.market),
            accounts
                .identity
                .other_market
                .as_deref_mut()
                .map(|market| &mut **market),
        ],
        clock,
    )?;
    let (insurance_credit, retained_fee, carry_before) =
        trading::split_fee(&mut accounts.identity.ledger, next.fee)?;

    emit(
        events,
        accounts,
        intent,
        order,
        next.gross,
        next.fee,
        insurance_credit,
        retained_fee,
        carry_before,
        clock.slot,
        executed,
    )
}

/// Wire-identical to LiquidityRouteExecuted. Borrow full roots/registrations so
/// event serialization does not allocate multiple full order-book copies.
#[derive(AnchorSerialize)]
pub(super) struct RouteEventView<'a> {
    pub venue: Pubkey,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: &'a Market,
    pub other_market_state: Option<&'a Market>,
    pub nonce: u64,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub insurance_credit: u64,
    pub retained_fee: u64,
    pub carry_before: u8,
    pub carry_after: u8,
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
    accounts: &ExecuteLiquidityRoute,
    intent: &RouteIntent,
    order: Option<crate::state::OrderRecord>,
    gross: u64,
    fee: u64,
    insurance_credit: u64,
    retained_fee: u64,
    carry_before: u8,
    slot: u64,
    legs: Vec<ExecutedLeg>,
) -> Result<()> {
    let identity = &accounts.identity;
    let mut roots: Vec<&MarginAccount> = vec![&identity.trader, &accounts.first_capital];
    let mut makers: Vec<&MakerRegistration> = vec![&accounts.first_registration];
    if legs.len() == 2 {
        roots.push(accounts.second_capital.as_deref().unwrap());
        makers.push(accounts.second_registration.as_deref().unwrap());
    }
    let event = RouteEventView {
        venue: identity.venue.key(),

        slot,
        market: identity.market.key(),
        market_state: &identity.market,
        other_market_state: identity.other_market.as_deref().map(|market| &**market),
        nonce: intent.nonce,
        side: intent.side,
        lots: intent.lots,
        gross_quote: gross,
        fee,
        insurance_credit,
        retained_fee,
        carry_before,
        carry_after: identity.ledger.insurance_fee_remainder,
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
    events.emit_borrowed::<crate::events::LiquidityRouteExecuted, _>(
        &event,
        accounts.event_authority.to_account_info(),
    )
}

//! Whole-account liquidation with strict post-fee deficit progress.
use super::*;

pub(crate) struct Candidate {
    pub target: Box<MarginAccountV2>,
    pub receiver: Box<MarginAccountV2>,
    pub gross_lots: u64,
    pub fee: u64,
    pub before: i128,
    pub after: i128,
}

#[inline(never)]
pub(crate) fn candidate(
    target: &MarginAccountV2,
    receiver: &MarginAccountV2,
    markets: [&GroupMarketV2; 2],
    mode: u8,
    market_index: usize,
    lots: u64,
    price: u64,
    clock: &Clock,
) -> Result<Candidate> {
    let target_model = account::model(target)?;
    let receiver_model = account::model(receiver)?;
    book::validate(target)?;
    book::validate(receiver)?;
    require!(
        market_index < 2
            && target.group == receiver.group
            && target_model.allows(market_index)
            && receiver_model.allows(market_index)
            && receiver.role != ROLE_MAKER
            && receiver.cash > 0,
        ClearingError::Liquidation
    );
    let market = markets[market_index];
    oracle::action(market, clock, false)?;
    let risks = risks(mode, markets, clock)?;
    let environment = book::Environment {
        markets: markets.map(Some),
        selected: market_index,
        funding: risks.map(|risk| risk.funding),
        slot: clock.slot,
        credible: markets.map(|market| oracle::action(market, clock, false).is_ok()),
    };
    // Target risk orders are cancelled by this candidate. They cannot force an
    // otherwise irrelevant stale market into the exposure valuation universe.
    for (index, position) in target.positions.iter().enumerate() {
        if position.lots != 0 {
            oracle::action(markets[index], clock, false)?;
        }
    }
    environment.admit_sources(receiver, clock, false)?;
    let before = checked(target_model.deficit(risks))?;
    let (next_target, next_receiver, fee) = checked(math::margin::liquidation_candidate(
        target_model,
        receiver_model,
        market_index,
        lots,
        price,
        market.reference_price,
        risks,
    ))?;
    let gross_lots = market
        .gross_lots
        .checked_sub(
            target_model.positions[market_index].lots.unsigned_abs()
                + receiver_model.positions[market_index].lots.unsigned_abs(),
        )
        .and_then(|gross| {
            gross.checked_add(
                next_target.positions[market_index].lots.unsigned_abs()
                    + next_receiver.positions[market_index].lots.unsigned_abs(),
            )
        })
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        gross_lots <= math::MAX_GROSS_LOTS,
        ClearingError::Liquidation
    );
    let mut target = Box::new(target.clone());
    let mut receiver = Box::new(receiver.clone());
    account::commit_model(&mut target, next_target)?;
    account::commit_model(&mut receiver, next_receiver)?;
    for entry in &mut target.book.orders {
        if entry.order.active() && !entry.order.reduce_only {
            entry.order.state = crate::constants::orders::INVALIDATED;
            entry.order.reserve = 0;
        }
    }
    book::refresh_with_environment(&mut target, &environment)?;
    book::refresh_with_environment(&mut receiver, &environment)?;
    checked(account::model(&receiver)?.admissible(risks))?;
    let after = checked(account::model(&target)?.deficit(risks))?;
    require!(after < before, ClearingError::Liquidation);
    advance(&mut target)?;
    advance(&mut receiver)?;
    Ok(Candidate {
        target,
        receiver,
        gross_lots,
        fee,
        before,
        after,
    })
}
pub(crate) fn risks(
    mode: u8,
    markets: [&GroupMarketV2; 2],
    clock: &Clock,
) -> Result<[math::margin::Risk; 2]> {
    let mut result = [math::margin::Risk::default(); 2];
    for (index, market) in markets.into_iter().enumerate() {
        result[index] = math::margin::Risk {
            lower: market.lower.max(1),
            upper: market.upper.max(1),
            funding: oracle::effective(mode, market, clock)?,
        };
    }
    Ok(result)
}

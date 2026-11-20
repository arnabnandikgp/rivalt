//! Funded receiver transfer for the finite local liquidation profile.
use super::*;
use crate::margin::{Margin, Risk, MARKETS};
pub const MAX_LIQUIDATION_LOTS: u64 = MAX_LOTS as u64;
pub const MAX_LIQUIDATION_FEE: u64 = 10_000;

fn receiver_fee(notional: u64, available_cash: u64) -> u64 {
    notional.div_ceil(2_000).min(MAX_LIQUIDATION_FEE).min(available_cash)
}

pub fn deficit(p: &Participant, lower: u64, upper: u64, funding: i128) -> Result<i128> {
    Ok(sub(
        scaled(p.margin(upper, MM_BPS)?)?,
        p.risk_equity(lower, upper, funding)?,
    )?
    .max(0))
}
/// Paired candidates only. The caller authenticates receiver consent and current
/// reference, refreshes both order books, and enforces receiver IM/capacity before
/// committing. Target reservations are not a substitute for deficit progress.
pub fn candidate(
    target: Participant,
    receiver: Participant,
    lots: u64,
    price: u64,
    reference: u64,
    lower: u64,
    upper: u64,
    funding: i128,
) -> Result<(Participant, Participant, u64)> {
    target.validate()?;
    receiver.validate()?;
    if target.id == receiver.id
        || target.lots == 0
        || lots == 0
        || lots > MAX_LIQUIDATION_LOTS
        || lots > target.lots.unsigned_abs()
        || reference == 0
        || reference > MAX_PRICE
        || price == 0
        || price > MAX_PRICE
        || u128::from(price) * u128::from(price_policy::EXECUTION_DENOMINATOR) < u128::from(reference) * u128::from(price_policy::EXECUTION_LOWER_NUMERATOR)
        || u128::from(price) * u128::from(price_policy::EXECUTION_DENOMINATOR) > u128::from(reference) * u128::from(price_policy::EXECUTION_UPPER_NUMERATOR)
    {
        return Err(Error::Bounds);
    }
    let before = deficit(&target, lower, upper, funding)?;
    if before == 0 {
        return Err(Error::Health);
    }
    let notional = lots.checked_mul(price).ok_or(Error::Overflow)?;
    let (mut t, mut r) = if target.lots > 0 {
        let (r, t) = fill(receiver, target, lots, notional, funding)?;
        (t, r)
    } else {
        fill(target, receiver, lots, notional, funding)?
    };
    let fee = receiver_fee(notional, t.cash);
    t.cash = cash_sub(t.cash, fee)?;
    r.cash = cash_add(r.cash, fee)?;
    if t.lots.unsigned_abs() >= target.lots.unsigned_abs()
        || deficit(&t, lower, upper, funding)? >= before
    {
        return Err(Error::Health);
    }
    Ok((t, r, fee))
}

pub fn whole_account_candidate(
    target: Margin,
    receiver: Margin,
    market: usize,
    lots: u64,
    price: u64,
    reference: u64,
    risks: [Risk; MARKETS],
) -> Result<(Margin, Margin, u64)> {
    target.validate()?;
    receiver.validate()?;
    if !target.allows(market)
        || !receiver.allows(market)
        || target.id == receiver.id
        || lots == 0
        || lots > liquidation::MAX_LIQUIDATION_LOTS
        || lots > target.positions[market].lots.unsigned_abs()
        || reference == 0
        || reference > MAX_PRICE
        || price == 0
        || price > MAX_PRICE
        || u128::from(price) * u128::from(price_policy::EXECUTION_DENOMINATOR) < u128::from(reference) * u128::from(price_policy::EXECUTION_LOWER_NUMERATOR)
        || u128::from(price) * u128::from(price_policy::EXECUTION_DENOMINATOR) > u128::from(reference) * u128::from(price_policy::EXECUTION_UPPER_NUMERATOR)
    {
        return Err(Error::Bounds);
    }
    let before = target.deficit(risks)?;
    if before == 0 {
        return Err(Error::Health);
    }
    let funding = risks.map(|risk| risk.funding);
    let target = target.accrued(funding)?;
    let receiver = receiver.accrued(funding)?;
    let notional = lots.checked_mul(price).ok_or(Error::Overflow)?;
    let (target_position, receiver_position) = if target.positions[market].lots > 0 {
        let (receiver_position, target_position) = fill(
            receiver.selected(market)?,
            target.selected(market)?,
            lots,
            notional,
            funding[market],
        )?;
        (target_position, receiver_position)
    } else {
        fill(
            target.selected(market)?,
            receiver.selected(market)?,
            lots,
            notional,
            funding[market],
        )?
    };
    let mut next_target = target.with_selected(market, target_position)?;
    let mut next_receiver = receiver.with_selected(market, receiver_position)?;
    let fee = receiver_fee(notional, next_target.cash);
    next_target.cash = cash_sub(next_target.cash, fee)?;
    next_receiver.cash = cash_add(next_receiver.cash, fee)?;
    if next_target.positions[market].lots.unsigned_abs()
        >= target.positions[market].lots.unsigned_abs()
        || next_target.deficit(risks)? >= before
    {
        return Err(Error::Health);
    }
    Ok((next_target, next_receiver, fee))
}

/// A forced maker fill may restore maintenance on its final single lot only.
pub fn maker_progress(before_equity: i128, before_deficit: i128, after_equity: i128, after_deficit: i128, lots: u64) -> bool {
    after_deficit < before_deficit && after_equity >= before_equity && (after_deficit > 0 || lots == 1)
}

/// Apply the adverse index bound independently to every maker leg.
pub fn maker_price(side: u8, lots: u64, gross: u64, lower: u64, upper: u64) -> bool {
    let gross = u128::from(gross);
    let lots = u128::from(lots);
    match side {
        0 => gross <= lots * u128::from(upper),
        1 => gross >= lots * u128::from(lower),
        _ => false,
    }
}

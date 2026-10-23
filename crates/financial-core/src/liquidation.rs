//! Funded receiver transfer for the finite local liquidation profile.
use super::*;
pub const MAX_LIQUIDATION_LOTS: u64 = 4_608;
pub const MAX_LIQUIDATION_FEE: u64 = 10_000;

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
        || u128::from(price) * 10 < u128::from(reference) * 9
        || u128::from(price) * 10 > u128::from(reference) * 11
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
    let fee = notional
        .div_ceil(2_000)
        .min(MAX_LIQUIDATION_FEE)
        .min(t.cash);
    t.cash = cash_sub(t.cash, fee)?;
    r.cash = cash_add(r.cash, fee)?;
    if t.lots.unsigned_abs() >= target.lots.unsigned_abs()
        || deficit(&t, lower, upper, funding)? >= before
    {
        return Err(Error::Health);
    }
    Ok((t, r, fee))
}

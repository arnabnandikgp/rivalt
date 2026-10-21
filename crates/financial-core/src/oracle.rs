//! Finite synthetic source/funding profile. Authentication is the adapter's job.
use super::{Error, Result, MAX_FUNDING, SCALE};
pub const SOURCE_AGE: i64 = 20;
pub const FUTURE_SKEW: i64 = 2;
pub const SAMPLE_INTERVAL: i64 = 2;
pub const HOLD: i64 = 6;
pub const MAX_CATCHUP: i64 = 30;
pub const RECOVERY: i64 = 6;
pub const FUNDING_OUTAGE: i64 = 12;
pub const REFERENCE_NOTIONAL: u64 = 6_000_000;
pub const PERIOD: i128 = 3_600;
pub const CAP_BPS: i128 = 50;
#[derive(Clone, Copy, Debug)]
pub struct Price {
    pub value: i64,
    pub confidence: u64,
    pub exponent: i32,
    pub published: i64,
}
/// Fixed -6 USD exponent: unlike collateral parity, this is an explicit source schema.
pub fn valid(p: Price, now: i64, collateral: bool) -> bool {
    let (min, max, confidence) = if collateral {
        (500_000, 1_500_000, 25)
    } else {
        (10_000_000_000, 100_000_000_000, 50)
    };
    p.exponent == -6
        && (min..=max).contains(&p.value)
        && p.published > 0
        && p.published <= i64::MAX - SOURCE_AGE
        && p.published <= now.saturating_add(FUTURE_SKEW)
        && now.saturating_sub(p.published) <= SOURCE_AGE
        && u128::from(p.confidence) * 10_000 <= (p.value as u128) * confidence
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bounds {
    pub reference: u64,
    pub lower: u64,
    pub upper: u64,
    pub normal: bool,
    pub deadline: i64,
}
pub fn bounds(primary: [Price; 2], guard: Option<[Price; 2]>, now: i64) -> Result<Bounds> {
    if !valid(primary[0], now, false) || !valid(primary[1], now, true) {
        return Err(Error::Bounds);
    }
    let ratio = |a: Price, b: Price| -> u64 { (a.value as u128 / b.value as u128) as u64 };
    let reference = ratio(primary[0], primary[1]);
    if !(10_000..=100_000).contains(&reference) {
        return Err(Error::Bounds);
    }
    // Conservative confidence conversion, then an explicit one-percent model envelope.
    let interval = |p: [Price; 2]| -> (u64, u64) {
        let low = (p[0].value as u128 - u128::from(p[0].confidence)) * 99
            / (p[1].value as u128 + u128::from(p[1].confidence))
            / 100;
        let numerator = (p[0].value as u128 + u128::from(p[0].confidence)) * 101;
        let denominator = (p[1].value as u128 - u128::from(p[1].confidence)) * 100;
        (low as u64, numerator.div_ceil(denominator) as u64)
    };
    let (mut lower, mut upper) = interval(primary);
    let mut deadline = primary
        .iter()
        .map(|p| p.published + SOURCE_AGE)
        .min()
        .unwrap();
    let mut normal = false;
    if let Some(g) = guard.filter(|g| valid(g[0], now, false) && valid(g[1], now, true)) {
        let other = ratio(g[0], g[1]);
        if reference.abs_diff(other) * 10_000 > reference * 100 {
            return Err(Error::Health);
        }
        let (l, u) = interval(g);
        lower = lower.min(l);
        upper = upper.max(u);
        deadline = deadline.min(g.iter().map(|p| p.published + SOURCE_AGE).min().unwrap());
        normal = primary[1].value >= 950_000
            && primary[1].value <= 1_050_000
            && g[1].value >= 950_000
            && g[1].value <= 1_050_000;
    } else {
        lower = lower.min(reference * 97 / 100);
        upper = upper.max((reference * 103).div_ceil(100));
    }
    Ok(Bounds {
        reference,
        lower,
        upper,
        normal,
        deadline,
    })
}
/// Premium in scaled atoms/lot, truncated toward zero once per sample (<1 scaled unit).
pub fn premium(reference: u64, quantity: u64, bid: u64, ask: u64) -> Result<i128> {
    if !(10_000..=100_000).contains(&reference)
        || quantity == 0
        || quantity > 600
        || bid == 0
        || ask < bid
    {
        return Err(Error::Bounds);
    }
    let midpoint = (i128::from(bid) + i128::from(ask)
        - 2 * i128::from(quantity) * i128::from(reference))
        * SCALE
        / (2 * i128::from(quantity));
    let cap = i128::from(reference) * SCALE * CAP_BPS / 10_000;
    Ok(midpoint.clamp(-cap, cap))
}
pub fn endpoint(base: i128, premium: i128, start: i64, end: i64, now: i64) -> Result<i128> {
    if start <= 0
        || end
            .checked_sub(start)
            .is_none_or(|n| !(0..=HOLD).contains(&n))
        || now < start
        || premium.unsigned_abs() > (100_000 * SCALE * CAP_BPS / 10_000) as u128
    {
        return Err(Error::Bounds);
    }
    let elapsed = now.min(end) - start;
    let next = base
        .checked_add(
            premium
                .checked_mul(i128::from(elapsed))
                .ok_or(Error::Overflow)?
                / PERIOD,
        )
        .ok_or(Error::Overflow)?;
    if next.unsigned_abs() > MAX_FUNDING as u128 {
        return Err(Error::Bounds);
    }
    Ok(next)
}

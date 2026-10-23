//! Finite synthetic source/funding profile. Authentication is the adapter's job.
use super::{Error, Result, MAX_FUNDING, SCALE};
pub const SOURCE_AGE: i64 = 20;
pub const DEVNET_SOURCE_AGE: i64 = 30;
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
    valid_at_age(p, now, collateral, SOURCE_AGE)
}
fn valid_at_age(p: Price, now: i64, collateral: bool, source_age: i64) -> bool {
    let (min, max, confidence) = if collateral {
        (500_000, 1_500_000, 25)
    } else {
        (10_000_000_000, 100_000_000_000, 50)
    };
    p.exponent == -6
        && (min..=max).contains(&p.value)
        && p.published > 0
        && p.published <= i64::MAX - source_age
        && p.published <= now.saturating_add(FUTURE_SKEW)
        && now.saturating_sub(p.published) <= source_age
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
    bounds_at_age(primary, guard, now, SOURCE_AGE)
}
/// D37's explicitly selected devnet-only allowance. No funding/recovery change.
pub fn devnet_bounds(primary: [Price; 2], guard: Option<[Price; 2]>, now: i64) -> Result<Bounds> {
    bounds_at_age(primary, guard, now, DEVNET_SOURCE_AGE)
}
fn bounds_at_age(
    primary: [Price; 2],
    guard: Option<[Price; 2]>,
    now: i64,
    source_age: i64,
) -> Result<Bounds> {
    if !valid_at_age(primary[0], now, false, source_age)
        || !valid_at_age(primary[1], now, true, source_age)
    {
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
        .map(|p| p.published + source_age)
        .min()
        .unwrap();
    let mut normal = false;
    if let Some(g) = guard.filter(|g| {
        valid_at_age(g[0], now, false, source_age) && valid_at_age(g[1], now, true, source_age)
    }) {
        let other = ratio(g[0], g[1]);
        if reference.abs_diff(other) * 10_000 > reference * 100 {
            return Err(Error::Health);
        }
        let (l, u) = interval(g);
        lower = lower.min(l);
        upper = upper.max(u);
        deadline = deadline.min(g.iter().map(|p| p.published + source_age).min().unwrap());
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

#[cfg(test)]
mod devnet_profile_tests {
    use super::*;

    fn pair(published: i64) -> [Price; 2] {
        [
            Price {
                value: 60_000_000_000,
                confidence: 10_000_000,
                exponent: -6,
                published,
            },
            Price {
                value: 1_000_000,
                confidence: 100,
                exponent: -6,
                published,
            },
        ]
    }

    #[test]
    fn fixed_profiles_preserve_distinct_age_and_exclusive_action_deadlines() {
        let p = pair(1000);
        for age in [19, 20, 21, 29, 30, 31] {
            let local = bounds(p, Some(p), 1000 + age);
            let devnet = devnet_bounds(p, Some(p), 1000 + age);
            assert_eq!(local.is_ok(), age <= 20);
            assert_eq!(devnet.is_ok(), age <= 30);
            if let Ok(b) = local {
                assert_eq!(b.deadline, 1020);
            }
            if let Ok(b) = devnet {
                assert_eq!(b.deadline, 1030);
            }
        }
        assert_eq!(RECOVERY, 6);
        assert_eq!(HOLD, 6);
        assert_eq!(FUNDING_OUTAGE, 12);
    }

    #[test]
    fn devnet_allowance_does_not_admit_bad_confidence_future_or_overflow() {
        let p = pair(1000);
        assert!(devnet_bounds(p, Some(p), 997).is_err());
        let mut bad = p;
        bad[1].confidence = 2501;
        assert!(devnet_bounds(bad, Some(p), 1029).is_err());
        assert!(devnet_bounds(pair(i64::MAX - 29), None, i64::MAX - 1).is_err());
        let old_guard = pair(989);
        assert!(!devnet_bounds(p, Some(old_guard), 1029).unwrap().normal);
    }
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

/// Integer marginal prices whose exact route cross-products remain in band.
pub fn execution_band(reference: u64) -> Result<(u64, u64)> {
    if !(10_000..=100_000).contains(&reference) {
        return Err(Error::Bounds);
    }
    Ok(((reference * 9).div_ceil(10), reference * 11 / 10))
}

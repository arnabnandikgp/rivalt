use financial_core::{oracle::*, Error};
fn pair(asset: i64, confidence: u64, collateral: i64) -> [Price; 2] {
    [
        Price {
            value: asset,
            confidence,
            exponent: -6,
            published: 1000,
        },
        Price {
            value: collateral,
            confidence: 0,
            exponent: -6,
            published: 1000,
        },
    ]
}
#[test]
fn independent_market_units_and_conservative_rounding() {
    let btc = pair(60_000_000_000, 0, 1_000_000);
    let eth = pair(3_000_000_000, 0, 1_000_000);
    assert_eq!(
        market_bounds(1_000_000, btc, Some(btc), 1000).unwrap(),
        Bounds {
            reference: 60_000,
            lower: 59_400,
            upper: 60_600,
            normal: true,
            deadline: 1020
        }
    );
    assert_eq!(
        market_bounds(100_000, eth, Some(eth), 1000).unwrap(),
        Bounds {
            reference: 30_000,
            lower: 29_700,
            upper: 30_300,
            normal: true,
            deadline: 1020
        }
    );
    // 3000.000001 / 1.000001 dollars, 1e5 lots/unit, 1e6 quote atoms/token.
    let fraction = pair(3_000_000_001, 1, 1_000_001);
    assert_eq!(
        market_bounds(100_000, fraction, Some(fraction), 1000).unwrap(),
        Bounds {
            reference: 29_999,
            lower: 29_699,
            upper: 30_300,
            normal: true,
            deadline: 1020
        }
    );
    assert!(market_bounds(100_000, btc, Some(btc), 1000).is_err());
    assert!(market_bounds(1_000_000, eth, Some(eth), 1000).is_err());
    assert!(market_bounds(10_000, eth, Some(eth), 1000).is_err());
}
#[test]
fn eth_age_confidence_guard_and_checked_scaling() {
    let eth = pair(3_000_000_000, 15_000_000, 1_000_000);
    assert!(market_bounds(100_000, eth, Some(eth), 1020).is_ok());
    assert_eq!(
        market_bounds(100_000, eth, Some(eth), 1021),
        Err(Error::Bounds)
    );
    assert!(market_bounds(
        100_000,
        pair(3_000_000_000, 15_000_001, 1_000_000),
        Some(eth),
        1000
    )
    .is_err());
    let bad_guard = pair(3_100_000_000, 0, 1_000_000);
    assert_eq!(
        market_bounds(100_000, eth, Some(bad_guard), 1000),
        Err(Error::Health)
    );
    assert!(!market_bounds(100_000, eth, None, 1000).unwrap().normal);
    assert_eq!(
        market_bounds(100_000, pair(i64::MAX, 0, 1_000_000), None, 1000),
        Err(Error::Overflow)
    );
    assert!(market_bounds(
        100_000,
        pair(3_000_000_000, u64::MAX, 1_000_000),
        None,
        1000
    )
    .is_err());
}

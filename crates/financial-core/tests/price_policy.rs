use financial_core::{
    oracle::{execution_band, market_bounds, premium, Price},
    orders::reserve,
    price_policy,
};
fn pair(asset: i64, collateral: i64) -> [Price; 2] {
    [asset, collateral].map(|value| Price {
        value,
        confidence: 0,
        exponent: -6,
        published: 1_000,
    })
}
#[test]
fn converted_edges_old_cliffs_and_depeg_restrictions() {
    for (units, multiplier) in [(1_000_000, 1), (100_000, 10)] {
        for (normalized, expected) in [
            (1_999_990, None),
            (2_000_000, Some((2, 1, 3))),
            (9_999_000_000, Some((9_999, 9_899, 10_099))),
            (100_001_000_000, Some((100_001, 99_000, 101_002))),
            (909_090_000_000, Some((909_090, 899_999, 918_181))),
            (909_090_999_990, Some((909_090, 900_000, 918_182))),
            (909_091_000_000, None),
        ] {
            let prices = pair(normalized / multiplier, 1_000_000);
            let result = market_bounds(units, prices, Some(prices), 1_000);
            assert_eq!(
                result
                    .as_ref()
                    .ok()
                    .map(|b| (b.reference, b.lower, b.upper)),
                expected
            );
            if let Ok(bounds) = result {
                assert!(bounds.normal);
            }
        }
        for prices in [
            pair(2_000_000 / multiplier, 1_500_000),
            pair(909_090_000_000 / multiplier, 500_000),
        ] {
            assert!(market_bounds(units, prices, Some(prices), 1_000).is_err());
        }
        let prices = pair(30_000_000_000 / multiplier, 500_000);
        let bounds = market_bounds(units, prices, Some(prices), 1_000).unwrap();
        assert_eq!(
            (bounds.reference, bounds.lower, bounds.upper, bounds.normal),
            (60_000, 59_400, 60_600, false)
        );
    }
}
#[test]
fn full_numeric_order_reservations_and_trigger_policy() {
    // Loss + ceil(10% * upper) + fee; sources missing -> full numeric interval.
    for (side, limit, expected) in [
        (0, 1, 100_007),
        (0, 1_000_000, 1_100_006),
        (1, 1, 1_100_006),
        (1, 1_000_000, 100_007),
    ] {
        assert_eq!(
            reserve(1, limit, 7, side, false, 1, 1_000_000).unwrap(),
            expected
        );
        assert_eq!(
            reserve(1, limit, 7, side, true, 1, 1_000_000).unwrap(),
            expected - 100_000
        );
    }
    for price in [0, 1_000_001] {
        assert!(reserve(1, price, 7, 0, false, 1, 1_000_000).is_err());
    }
    for (price, valid) in [
        (1, false),
        (2, true),
        (9_999, true),
        (100_001, true),
        (909_090, true),
        (909_091, false),
    ] {
        assert_eq!(price_policy::trigger_in_policy(price), valid);
    }
    assert_eq!(execution_band(2).unwrap(), (2, 2));
    assert_eq!(execution_band(909_090).unwrap(), (818_181, 999_999));
    assert_eq!(premium(2, 3_000_000, 6_000_000, 6_000_000).unwrap(), 0);
    assert!(premium(2, 3_000_001, 6_000_002, 6_000_002).is_err());
}
#[test]
fn extreme_confidence_guard_and_missing_guard_never_clip_risk() {
    let mut low = pair(2_000_000, 1_000_000);
    low[0].confidence = 10_000;
    low[1].confidence = 2_500;
    let bounds = market_bounds(1_000_000, low, Some(low), 1000).unwrap();
    assert_eq!((bounds.lower, bounds.upper), (1, 3));
    let high = pair(909_090_000_000, 1_000_000);
    let mut guard = pair(918_180_999_999, 1_000_000);
    guard[0].confidence = 4_590_904_999;
    guard[1].confidence = 2_500;
    let bounds = market_bounds(1_000_000, high, Some(guard), 1000).unwrap();
    assert_eq!(
        (bounds.reference, bounds.lower, bounds.upper),
        (909_090, 899_999, 934_336)
    );
    guard[0].value += 1;
    assert!(market_bounds(1_000_000, high, Some(guard), 1000).is_err());
    let bounds = market_bounds(1_000_000, high, None, 1000).unwrap();
    assert_eq!(
        (bounds.lower, bounds.upper, bounds.normal),
        (881_817, 936_363, false)
    );
    // Optional invalid/overflowing guard degrades, never wraps into valid data.
    assert_eq!(
        market_bounds(
            100_000,
            pair(90_909_000_000, 1_000_000),
            Some(pair(i64::MAX, 1_000_000)),
            1000
        )
        .unwrap(),
        bounds
    );
    for value in [0, -1, i64::MAX] {
        assert!(market_bounds(1_000_000, pair(value, 1_000_000), None, 1000).is_err());
    }
}

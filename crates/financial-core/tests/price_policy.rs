use financial_core::{
    oracle::{market_bounds, Price},
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
fn actual_conversion_preserves_both_market_edges_and_depeg_restrictions() {
    // Literal USD micro-prices, not values calculated from implementation limits.
    for (units, low, high) in [
        (1_000_000, 10_000_000_000, 100_000_000_000),
        (100_000, 1_000_000_000, 10_000_000_000),
    ] {
        for (asset, expected) in [
            (low - 1, None),
            (low, Some((10_000, 9_900, 10_100))),
            (high, Some((100_000, 99_000, 101_000))),
            (high + 1, None),
        ] {
            let prices = pair(asset, 1_000_000);
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
        // A valid raw asset is not sufficient when the collateral conversion is
        // outside policy. Depeg never receives positive unpaid-profit credit.
        for prices in [pair(low, 1_500_000), pair(high, 500_000)] {
            assert!(market_bounds(units, prices, Some(prices), 1_000).is_err());
        }
        let prices = pair(low * 3, 500_000);
        let bounds = market_bounds(units, prices, Some(prices), 1_000).unwrap();
        assert_eq!(
            (bounds.reference, bounds.lower, bounds.upper, bounds.normal),
            (60_000, 59_400, 60_600, false)
        );
    }
}

#[test]
fn full_numeric_risk_does_not_expand_signed_order_or_trigger_policy() {
    // Missing-source reservation uses the full proved price range. A policy
    // refactor must preserve these loss + ceil(IM) + fee literals.
    assert_eq!(
        reserve(1, 9_000, 7, 0, false, 1, 1_000_000).unwrap(),
        109_006
    );
    assert_eq!(
        reserve(1, 110_000, 7, 1, false, 1, 1_000_000).unwrap(),
        990_007
    );
    for price in [8_999, 110_001, 1_000_000] {
        assert!(reserve(1, price, 7, 0, false, 1, 1_000_000).is_err());
    }
    for (price, valid) in [
        (9_999, false),
        (10_000, true),
        (100_000, true),
        (100_001, false),
    ] {
        assert_eq!(price_policy::trigger_in_policy(price), valid);
    }
}

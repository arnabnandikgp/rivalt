use maker_interface::canonical::{quote_amount, LiquidityShape, PriceRegion, MAX_DEPTH};

#[test]
fn full_width_flat_curve_and_consumed_prefix_are_exact() {
    let mut shape = LiquidityShape {
        mode: 1,
        ttl_slots: 150,
        skew_step: 1,
        long_cap: MAX_DEPTH,
        short_cap: MAX_DEPTH,
        ask_count: 1,
        ..Default::default()
    };
    shape.asks[0] = PriceRegion {
        end_lots: MAX_DEPTH,
        offset: 999_999,
        slope: 0,
    };
    assert_eq!(
        quote_amount(&shape, 1, 0, MAX_DEPTH, 0, 0).unwrap(),
        (100_000_000_000_000, 0)
    );
    assert_eq!(
        quote_amount(&shape, 1, 0, 1, 0, MAX_DEPTH - 1).unwrap(),
        (1_000_000, 0)
    );
    assert!(quote_amount(&shape, 1, 0, 2, 0, MAX_DEPTH - 1).is_err());
    shape.asks[0].end_lots = MAX_DEPTH + 1;
    assert!(shape.validate().is_err());
}

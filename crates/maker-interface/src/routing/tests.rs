use super::*;
use crate::canonical::{LiquidityShape, PriceRegion, MAX_REGIONS};

fn shape(depth: u64, slope: u64) -> LiquidityShape {
    let mut regions = [PriceRegion::default(); MAX_REGIONS];
    regions[0] = PriceRegion {
        end_lots: depth,
        offset: 0,
        slope,
    };
    LiquidityShape {
        mode: 1,
        ttl_slots: 10,
        skew_step: 1,
        long_cap: depth,
        short_cap: depth,
        bid_count: 1,
        ask_count: 1,
        bids: regions,
        asks: regions,
        ..Default::default()
    }
}

fn order(side: u8, lots: u64, reference: u64) -> Order {
    Order {
        side,
        lots,
        reference,
        max_fee: u64::MAX,
        all_in_limit: if side == 0 { u64::MAX } else { 0 },
    }
}

#[test]
fn exhaustive_marginal_prices_and_disconnected_financial_admission() {
    let depths = [8, 6, 7];
    let slopes = [3, 0, 5];
    let shapes = [shape(8, 3), shape(6, 0), shape(7, 5)];
    for side in [0, 1] {
        for anchors in [
            [1000, 1000, 1000],
            [891, 1095, 1000],
            [1102, 903, 1002],
            [998, 1004, 1001],
        ] {
            let books = std::array::from_fn(|index| {
                Some(ExecutionCurve::new(&shapes[index], anchors[index], side, 0, 0).unwrap())
            });
            for total in 1..=16 {
                for mask in 0..8u64 {
                    // A funded account or a reservation can make one interior
                    // split admissible even with inadmissible neighbours.
                    let eligible = |lots: [u64; 3]| {
                        (0..3).all(|index| {
                            lots[index] == 0
                                || mask & (1 << index) == 0
                                || matches!(lots[index], 2 | 5)
                        })
                    };
                    let actual = select(order(side, total, 1000), books, |value| {
                        Ok::<_, QuoteError>(eligible(value.lots))
                    })
                    .unwrap();
                    let mut candidates = Vec::new();
                    for first in 0..=total {
                        for second in 0..=total - first {
                            let lots = [first, second, total - first - second];
                            let ids: Vec<_> = (0..3).filter(|index| lots[*index] > 0).collect();
                            if ids.len() > 2
                                || !eligible(lots)
                                || (0..3).any(|index| lots[index] > depths[index])
                            {
                                continue;
                            }
                            let amounts = std::array::from_fn(|index| {
                                (0..lots[index])
                                    .map(|level| {
                                        if side == 0 {
                                            anchors[index] + slopes[index] * level
                                        } else {
                                            anchors[index] - slopes[index] * level
                                        }
                                    })
                                    .sum::<u64>()
                            });
                            if (0..3).any(|index| {
                                amounts[index] < 900 * lots[index]
                                    || amounts[index] > 1100 * lots[index]
                            }) {
                                continue;
                            }
                            let gross = amounts.iter().sum::<u64>();
                            if gross < 1000 {
                                continue;
                            }
                            let fee = gross.div_ceil(5000);
                            let all_in = if side == 0 { gross + fee } else { gross - fee };
                            let score = if side == 0 {
                                i128::from(all_in)
                            } else {
                                -i128::from(all_in)
                            };
                            candidates.push((
                                (score, ids.len(), ids, std::cmp::Reverse(lots)),
                                Allocation {
                                    lots,
                                    amounts,
                                    gross,
                                    fee,
                                    all_in,
                                },
                            ));
                        }
                    }
                    let expected = candidates
                        .into_iter()
                        .min_by(|left, right| left.0.cmp(&right.0))
                        .map(|(_, value)| value);
                    assert_eq!(
                        actual, expected,
                        "side={side} total={total} mask={mask} anchors={anchors:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn sell_fee_plateau_prefers_more_lots_on_first_maker() {
    let sloping = shape(2, 1);
    let flat = shape(2, 0);
    let books = [
        Some(ExecutionCurve::new(&sloping, 1667, 1, 0, 0).unwrap()),
        Some(ExecutionCurve::new(&flat, 1667, 1, 0, 0).unwrap()),
        None,
    ];
    // Both yield 4,999 after fees. One lot on the first maker yields 5,001
    // gross; two lots yield 5,000 gross and win the quantity tie.
    let winner = select(order(1, 3, 1667), books, |_| Ok::<_, QuoteError>(true))
        .unwrap()
        .unwrap();
    assert_eq!(
        (winner.lots, winner.gross, winner.all_in),
        ([2, 1, 0], 5000, 4999)
    );
}

#[test]
fn large_order_and_admission_error_are_exact() {
    let flat = shape(MAX_DEPTH, 0);
    let half = shape(MAX_DEPTH / 2, 0);
    let books = [
        Some(ExecutionCurve::new(&half, 5000, 0, 0, 0).unwrap()),
        Some(ExecutionCurve::new(&flat, 5001, 0, 0, 0).unwrap()),
        None,
    ];
    let winner = select(order(0, MAX_DEPTH, 5000), books, |_| {
        Ok::<_, QuoteError>(true)
    })
    .unwrap()
    .unwrap();
    assert_eq!(winner.lots, [MAX_DEPTH / 2, MAX_DEPTH / 2, 0]);
    assert_eq!(
        select(order(0, MAX_DEPTH, 5000), books, |_| Err(
            QuoteError::Binding
        )),
        Err(QuoteError::Binding)
    );
}

#[test]
fn only_flattening_the_first_maker_releases_enough_margin() {
    use financial_core::{liquidity::PreparedMakerRisk, Participant, SCALE};

    let flat = shape(4, 0);
    let first = ExecutionCurve::new(&flat, 10_010, 0, 3, 0).unwrap();
    let second = ExecutionCurve::new(&flat, 10_012, 0, 0, 0).unwrap();
    let maker = PreparedMakerRisk::new(
        Participant {
            cash: 500,
            lots: 3,
            virtual_scaled: -30_000 * SCALE,
            generation: 1,
            ..Participant::default()
        },
        9900,
        10100,
        SCALE,
    )
    .unwrap();
    for (reserve, expected) in [(500, [3, 1, 0]), (501, [0, 4, 0])] {
        let selected = select(
            order(0, 4, 10_000),
            [Some(first), Some(second), None],
            |route| {
                let quantity = route.lots[0];
                Ok::<_, QuoteError>(
                    quantity == 0
                        || maker
                            .quote(0, quantity, route.amounts[0])
                            .unwrap()
                            .admits(reserve),
                )
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(selected.lots, expected);
    }
}

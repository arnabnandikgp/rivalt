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

#[test]
fn incomplete_search_discards_an_admitted_singleton() {
    let flat = shape(100, 0);
    let curve = |anchor| ExecutionCurve::new(&flat, anchor, 0, 0, 0).unwrap();
    let books = [Some(curve(5001)), Some(curve(5000)), Some(curve(5000))];
    for budget in [
        SearchWork {
            intervals: 1000,
            quotes: 2000,
            admissions: 1,
        },
        SearchWork {
            intervals: 1,
            quotes: 2000,
            admissions: 1000,
        },
        SearchWork {
            intervals: 1000,
            quotes: 50,
            admissions: 1000,
        },
    ] {
        let mut accepted = false;
        let result = select_with_budget(
            order(0, 100, 5000),
            books,
            |route| {
                let admit = route.lots[0] == 100;
                accepted |= admit;
                Ok::<_, QuoteError>(admit)
            },
            budget,
        );
        assert!(accepted);
        assert_eq!(result, Err(QuoteError::SearchLimit));
    }
}

#[test]
fn clearing_search_stops_before_a_fifth_financial_admission() {
    let flat = shape(4096, 0);
    let curve = ExecutionCurve::new(&flat, 60_000, 0, 0, 0).unwrap();
    let mut admissions = 0;
    let result = select_for_clearing(order(0, 400, 60_000), [Some(curve); 3], |_| {
        admissions += 1;
        Ok::<_, QuoteError>(false)
    });
    assert_eq!(result, Err(QuoteError::SearchLimit));
    assert_eq!(admissions, 4);
}

#[test]
fn funded_depth_preserves_every_quantity_that_can_meet_initial_margin() {
    let book = shape(20, 0);
    for side in [0, 1] {
        for inventory in -5..=5 {
            let curve = ExecutionCurve::new(&book, 30_001, side, inventory, 0).unwrap();
            for cash in [0, 1, 3_000, 3_001, 6_000, 6_001, financial_core::MAX_CASH] {
                let bounded = curve.with_funded_cash(cash, 30_001).unwrap();
                for quantity in 1..=curve.capacity() {
                    let after = inventory
                        + if side == 0 {
                            -(quantity as i64)
                        } else {
                            quantity as i64
                        };
                    // Independent ten-percent IM, rounded up to the collateral atom.
                    let required = (after.unsigned_abs() * 30_001).div_ceil(10);
                    if required <= cash {
                        assert!(quantity <= bounded.capacity());
                    }
                }
                assert!(bounded.capacity() <= curve.capacity());
            }
        }
    }
}

#[test]
fn eth_funded_singleton_wins_inside_the_original_clearing_budget() {
    let book = shape(10_000, 0);
    let books = std::array::from_fn(|index| {
        let curve = ExecutionCurve::new(&book, 30_002 + 2 * index as u64, 0, 0, 0).unwrap();
        Some(
            curve
                .with_funded_cash(if index == 0 { 1 } else { 500_000_000_000 }, 30_001)
                .unwrap(),
        )
    });
    for (limit, expected) in [(100_053_343, Some([0, 3334, 0])), (100_046_674, None)] {
        let request = Order {
            all_in_limit: limit,
            ..order(0, 3334, 30_000)
        };
        let result = select_for_clearing(request, books, |candidate| {
            assert_eq!(candidate.lots[0], 0);
            Ok::<_, QuoteError>(true)
        })
        .unwrap();
        assert_eq!(result.map(|allocation| allocation.lots), expected);
    }
}

#[test]
fn fragmented_dollar_order_requires_three_real_quantities_and_one_fee() {
    let flat = shape(65_000, 0);
    let curves = [61_002,61_004,61_006].map(|anchor| Some(ExecutionCurve::new(&flat,anchor,0,0,0).unwrap()));
    let result = marginal::best_marginals(order(0,163_935,61_000), &curves).unwrap().unwrap();
    assert_eq!(result.lots,[65_000,65_000,33_935]);
    let gross = 65_000*61_002 + 65_000*61_004 + 33_935*61_006;
    assert_eq!((result.gross,result.fee),(gross,(gross+4_999)/5_000));
    assert!(marginal::best_marginals(order(0,163_935,61_000), &curves[..2]).unwrap().is_none());
}

#[test]
fn whole_lot_price_optimum_matches_expanded_book_on_both_sides_for_four_to_eight_makers() {
    for count in 4..=8 {
        let mut shapes = Vec::new();
        for id in 0..count {
            let mut book = shape(2 + id as u64, id as u64 % 3);
            book.skew_tick = id as u64 % 2;
            book.skew_step = 2;
            shapes.push(book);
        }
        for side in [0,1] {
            let curves:Vec<_>=shapes.iter().enumerate().map(|(id,book)|Some(ExecutionCurve::new(book,
                60_000+id as u64%3,side,0,0).unwrap())).collect();
            let mut unit_prices=Vec::new();
            for (id,_) in shapes.iter().enumerate() {
                for index in 0..2+id {
                    // Independent formula for this one-region book at zero inventory.
                    let spread=(id % 3)*index + (id%2)*(index/2);
                    let price=60_000+(id%3) as i64 + if side==0 {spread as i64} else {-(spread as i64)};
                    unit_prices.push(price as u64);
                }
            }
            unit_prices.sort();
            if side == 1 {unit_prices.reverse();}
            for size in 1..=unit_prices.len() {
                let result=marginal::best_marginals(order(side,size as u64,60_000),&curves).unwrap().unwrap();
                assert_eq!(result.gross,unit_prices[..size].iter().sum::<u64>());
                assert_eq!(result.lots.iter().sum::<u64>(),size as u64);
            }
        }
    }
}

#[test]
fn constrained_eth_maker_shares_order_at_its_last_affordable_lot() {
    let flat = shape(200_000, 0);
    let curves = [30_200, 29_996, 29_994, 29_992].map(|price| {
        let cash = if price == 30_200 { 240_000_000 } else { 500_000_000_000 };
        Some(ExecutionCurve::new(&flat, price, 1, 0, 0).unwrap()
            .with_opening_cash(cash, 29_700, 30_300, 100_000).unwrap())
    });
    let result = marginal::best_marginals(order(1, 100_000, 30_000), &curves).unwrap().unwrap();
    assert_eq!(result.lots, [67_988, 32_012, 0, 0]);
    assert_eq!((result.gross, result.fee, result.all_in), (3_013_469_552, 602_694, 3_012_866_858));
    let strict = Order { all_in_limit: result.all_in + 1, ..order(1, 100_000, 30_000) };
    assert!(marginal::best_marginals(strict, &curves).unwrap().is_none());
}

#[test]
fn opening_bound_never_discards_an_affordable_prefix() {
    for side in [0, 1] {
        for slope in [0, 25, 190] {
            let book = shape(20, slope);
            for anchor in [9_001, 10_823] {
                let curve = ExecutionCurve::new(&book, anchor, side, 0, 0).unwrap();
                let mut gross = 0_i64;
                for lots in 1..=20 {
                    let price = anchor as i64 + (if side == 0 { 1 } else { -1 }) * (lots-1) as i64 * slope as i64;
                    gross += price;
                    let mark_loss = if side == 0 { lots as i64 * 10_003 - gross } else { gross - lots as i64 * 9_999 };
                    let required = (lots * 10_003_u64).div_ceil(10) + mark_loss.max(0) as u64;
                    assert!(curve.with_opening_cash(required, 9_999, 10_003, 20).unwrap().capacity() >= lots);
                    if slope == 0 {
                        assert!(curve.with_opening_cash(required-1, 9_999, 10_003, 20).unwrap().capacity() < lots);
                    }
                }
            }
        }
    }
}

#[test]
fn direct_prefix_matches_individual_prices_inside_consumed_regions() {
    let mut book = shape(23, 0);
    let mut regions = book.bids;
    regions[0] = PriceRegion { end_lots: 6, offset: 2, slope: 0 };
    regions[1] = PriceRegion { end_lots: 15, offset: 4, slope: 3 };
    regions[2] = PriceRegion { end_lots: 23, offset: 28, slope: 0 };
    book.bids = regions;
    book.asks = regions;
    book.ask_count = 3;
    book.bid_count = 3;
    for side in [0, 1] {
        for consumed in 0..23 {
            let curve = ExecutionCurve::new(&book, 1000, side, 0, consumed).unwrap();
            for cap in 1..=curve.capacity() {
                let base = if side == 0 { 1000 } else { -1000 };
                for offset in -1..32 {
                    let expected = (consumed..consumed+cap).filter(|&index| {
                        let price_offset = if index < 6 { 2 } else if index < 15 { 4+3*(index-6) } else { 28 };
                        price_offset as i64 <= offset
                    }).count() as u64;
                    assert_eq!(curve.unskewed_prefix(cap, base + offset).unwrap(), Some(expected));
                }
            }
        }
    }
}

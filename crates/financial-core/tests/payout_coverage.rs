//! Qualification only. Exact reads use the current lane storage in the model.
//! The exhaustive expected value uses all 16 price/funding corners independently.
#[path = "payout_coverage/lanes.rs"]
mod lanes;
use financial_core::{
    backing::{MarketRegion, Region},
    margin::{reconcile, route_candidate, Margin, Mode, Position, Risk},
    Error, Pools, MAX_CASH, SCALE,
};
use lanes::{Book, Verdict, LANES};

fn account(id: u64, cash: u64, lots: [i64; 2], fixed_atoms: [i64; 2]) -> Margin {
    Margin {
        id,
        cash,
        mode: Mode::Cross,
        reserved: 0,
        positions: std::array::from_fn(|m| Position {
            lots: lots[m],
            virtual_scaled: i128::from(fixed_atoms[m]) * SCALE,
            funding_checkpoint: 0,
            generation: u64::from(lots[m] != 0),
        }),
    }
}

fn point(btc: u64, eth: u64) -> Region {
    Region {
        markets: [btc, eth].map(|price| MarketRegion {
            price_low: price,
            price_high: price,
            funding_low: 0,
            funding_high: 0,
        }),
    }
}

fn reference_bad(root: &Margin, region: Region, target: usize) -> bool {
    let mut may_owe = false;
    let mut max_debt = 0;
    for corner in 0..16 {
        let claims: [i128; 2] = std::array::from_fn(|market| {
            let bounds = region.markets[market];
            let price = [bounds.price_low, bounds.price_high][(corner >> market) & 1];
            let funding = [bounds.funding_low, bounds.funding_high][(corner >> (2 + market)) & 1];
            let pos = root.positions[market];
            pos.virtual_scaled
                + i128::from(pos.lots)
                    * (i128::from(price) * SCALE - (funding - pos.funding_checkpoint))
        });
        may_owe |= claims[target] < 0;
        max_debt = max_debt.max(-claims[0].min(0) - claims[1].min(0));
    }
    may_owe && max_debt > i128::from(root.cash) * SCALE
}

fn compare(book: &Book, roots: &[Margin], region: Region, target: usize) -> lanes::Check {
    let bad: Vec<_> = roots
        .iter()
        .filter(|root| {
            let bad = reference_bad(root, region, target);
            assert_eq!(bad, region.contribution(root, target).unwrap().bad);
            bad
        })
        .map(|r| r.id)
        .collect();
    let check = book.check(target, region, u8::MAX).unwrap();
    match check.verdict {
        Verdict::Covered => assert!(bad.is_empty()),
        Verdict::Underfunded(id) => assert!(bad.contains(&id)),
        Verdict::MissingLanes(_) => panic!("all current bodies supplied"),
    }
    if check.required != 0 {
        let missing = 1 << check.required.trailing_zeros();
        assert_eq!(
            book.check(target, region, check.required ^ missing)
                .unwrap()
                .verdict,
            Verdict::MissingLanes(missing)
        );
    }
    check
}

#[test]
fn simultaneous_solvent_warnings_clear_without_reading_either_account() {
    for (template, region, target) in [
        (account(0, 80, [2, 1], [-200, -200]), point(70, 200), 0),
        (account(0, 1, [1, 0], [-100, 0]), point(99, 200), 0),
        (account(0, 2, [1, 0], [-100, -3]), point(130, 200), 0),
    ] {
        let mut book = Book::new([100, 200]).unwrap();
        let roots = [Margin { id: 7, ..template }, Margin { id: 15, ..template }];
        book.record(&roots).unwrap();
        let check = compare(&book, &roots, region, target);
        assert_eq!(
            (check.verdict, check.required, check.exact_rows),
            (Verdict::Covered, 0, 0)
        );
    }
}

#[test]
fn fill_between_preparation_and_claim_uses_current_debt_and_held_inputs() {
    let mut book = Book::new([100, 200]).unwrap();
    let mut roots = [
        account(0, 190, [0, 0], [0, -40]),
        Margin {
            mode: Mode::Isolated(0),
            ..account(1, 2000, [0, 0], [0, 0])
        },
        account(2, 0, [0, 0], [0, 50]),
        account(3, 0, [0, 0], [0, 50]),
    ];
    let mut pools = Pools {
        settlement: 60,
        vault: 2250,
        ..Default::default()
    };
    book.record(&roots).unwrap();
    let before = compare(&book, &roots, point(70, 200), 1);
    assert_eq!(before.required, 0);
    let risks = [100, 200].map(|price| Risk {
        lower: price,
        upper: price,
        funding: 0,
    });
    let (trader, makers, fee) =
        route_candidate(roots[0], &roots[1..2], 0, &[(10, 1000)], 0, [0; 2], 0).unwrap();
    for root in [trader, makers[0]] {
        root.admissible(risks).unwrap();
    }
    assert_eq!(fee, 1);
    roots[0] = trader;
    roots[1] = makers[0];
    book.record(&roots[..2]).unwrap();
    pools.fees += fee;
    reconcile(&roots, pools, [70, 200], [0; 2]).unwrap();

    // The fill was solvent at 100. At 70 the new BTC loss is 300, the
    // surviving ETH debt is 40, and the trader has only 189 after the fee.
    assert_eq!(
        compare(&book, &roots, point(100, 200), 1).verdict,
        Verdict::Covered
    );
    assert_eq!(
        book.check(1, point(70, 200), before.required)
            .unwrap()
            .verdict,
        Verdict::MissingLanes(1)
    );
    assert_eq!(
        compare(&book, &roots, point(70, 200), 1).verdict,
        Verdict::Underfunded(0)
    );

    roots[0].cash += 151;
    pools.vault += 151;
    book.record(&roots[..1]).unwrap();
    let repaired = compare(&book, &roots, point(70, 200), 1);
    assert_eq!(repaired.verdict, Verdict::Covered);
    assert_eq!(repaired.exact_rows, 1);
    let mut held = point(70, 200);
    held.markets[0].funding_high = 1;
    assert_eq!(
        book.check(1, held, repaired.required).unwrap().verdict,
        Verdict::Underfunded(0)
    );

    let exit_risks = [70, 200].map(|p| Risk {
        lower: p,
        upper: p,
        funding: 0,
    });
    let (recipient, after) = roots[2]
        .settle_claim(pools, 1, 50, [70, 200], exit_risks, true)
        .unwrap();
    roots[2] = recipient;
    book.record(&[recipient]).unwrap();
    assert_eq!((recipient.cash, after.settlement), (50, 10));
    reconcile(&roots, after, [70, 200], [0; 2]).unwrap();
}

#[test]
fn matched_population_rechecks_every_reference_outcome() {
    let mut counts = [0; 2];
    for size in [12, 1000] {
        let mut book = Book::new([100, 200]).unwrap();
        let mut roots: Vec<_> = (0..size)
            .map(|id| {
                let sign = if id % 2 == 0 { 1 } else { -1 };
                account(id, 1000, [sign, -sign], [-100 * sign, 200 * sign])
            })
            .collect();
        book.record(&roots).unwrap();
        let mut queries = Vec::new();
        for btc in [60, 85, 100, 115] {
            for eth in [170, 200, 237] {
                queries.push(point(btc, eth));
            }
        }
        let mut held = point(100, 200);
        for m in &mut held.markets {
            m.funding_low = -SCALE / 2;
            m.funding_high = SCALE / 2;
        }
        queries.extend([held, point(59, 241)]);
        for cash in [0, 20, 50, 1000] {
            roots[0].cash = cash;
            book.record(&roots[..1]).unwrap();
            for &region in &queries {
                for target in 0..2 {
                    let check = compare(&book, &roots, region, target);
                    counts[usize::from(check.verdict == Verdict::Covered)] += 1;
                }
            }
        }
    }
    assert_eq!(counts, [60, 164]);
}

#[test]
fn headers_can_prove_a_thousand_distinct_rows_or_need_every_one() {
    let mut book = Book::new([100, 200]).unwrap();
    let roots: Vec<_> = (0..1000)
        .map(|id| {
            let pair = id / 2;
            let quantity = pair as i64 + 1;
            let sign = if (id % 2 == 0) ^ (pair / 8 % 2 == 0) {
                1
            } else {
                -1
            };
            let mut lots = [0; 2];
            lots[(pair / 4 % 2) as usize] = sign * quantity;
            account(
                id,
                (if lots[0] == 0 { 100 } else { 30 }) * quantity as u64,
                lots,
                [-100 * lots[0], -200 * lots[1]],
            )
        })
        .collect();
    book.record(&roots).unwrap();
    for target in 0..2 {
        let easy = compare(&book, &roots, point(100, 200), target);
        let adverse = compare(&book, &roots, point(70, 170), target);
        assert_eq!((easy.verdict, easy.exact_rows), (Verdict::Covered, 0));
        assert_eq!(
            (
                adverse.verdict,
                adverse.cleared_by_radius.count_ones(),
                adverse.exact_rows
            ),
            (Verdict::Covered, LANES as u32, 0)
        );
        let uneven = compare(&book, &roots, point(70, 120), target);
        assert_eq!((uneven.verdict, uneven.exact_rows), (Verdict::Covered, 0));
    }

    // Give each account a position on both markets and just enough cash
    // for its own 30/80 shock. Each matched pair still nets to zero.
    let cross: Vec<_> = roots
        .iter()
        .map(|root| {
            let mut lots = root.positions.map(|p| p.lots);
            let active = usize::from(lots[0] == 0);
            lots[1 - active] = lots[active].signum();
            account(
                root.id,
                30 * lots[0].unsigned_abs() + 80 * lots[1].unsigned_abs(),
                lots,
                [-100 * lots[0], -200 * lots[1]],
            )
        })
        .collect();
    let mut cross_book = Book::new([100, 200]).unwrap();
    cross_book.record(&cross).unwrap();
    for target in 0..2 {
        let uneven = compare(&cross_book, &cross, point(70, 120), target);
        assert_eq!(
            (
                uneven.verdict,
                uneven.required.count_ones(),
                uneven.exact_rows
            ),
            (Verdict::Covered, LANES as u32, 1000)
        );
    }
}

#[test]
fn varied_state_changes_and_mixed_endpoints_match_both_references() {
    let mut seed = 104729u64;
    let mut draw = |max| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        (seed >> 24) % max
    };
    let mut outcomes = [0; 2];
    for _ in 0..64 {
        let mut book = Book::new([100, 200]).unwrap();
        let mut roots = Vec::new();
        for pair in 0..8 {
            let lots = [draw(9) as i64 - 4, draw(9) as i64 - 4];
            let fixed = [
                -100 * lots[0] + draw(41) as i64 - 20,
                -200 * lots[1] + draw(41) as i64 - 20,
            ];
            let mut long = account(pair * 2, draw(200), lots, fixed);
            let mut short = account(pair * 2 + 1, draw(200), lots.map(|v| -v), fixed.map(|v| -v));
            for m in 0..2 {
                let checkpoint = i128::from(draw(9)) - 4;
                let dust = i128::from(draw(3)) - 1;
                for (root, dust) in [(&mut long, dust), (&mut short, -dust)] {
                    root.positions[m].funding_checkpoint = checkpoint;
                    root.positions[m].virtual_scaled +=
                        dust - i128::from(root.positions[m].lots) * checkpoint;
                }
            }
            roots.extend([long, short]);
        }
        book.record(&roots).unwrap();
        for _ in 0..3 {
            let id = draw(16) as usize;
            roots[id].cash = draw(200);
            book.record(&roots[id..=id]).unwrap();
            let mut region = point(80 + draw(41), 180 + draw(41));
            for bounds in &mut region.markets {
                bounds.price_high += draw(4);
                bounds.funding_low = -i128::from(draw(10)) * SCALE / 4;
                bounds.funding_high = i128::from(draw(10)) * SCALE / 4;
            }
            for target in 0..2 {
                let result = compare(&book, &roots, region, target);
                outcomes[usize::from(result.verdict == Verdict::Covered)] += 1;
            }
        }
    }
    assert!(outcomes.into_iter().all(|count| count > 0));
    println!(
        "384 varied decisions: {} covered and {} underfunded",
        outcomes[1], outcomes[0]
    );
}

#[test]
fn membership_and_invalid_batch_cannot_hide_a_debtor() {
    let mut book = Book::new([100, 200]).unwrap();
    let adverse = point(70, 200);
    let debtor = account(4, 40, [1, 0], [-100, -40]);
    let empty = account(4, 0, [0, 0], [0, 0]);
    book.record(&[debtor]).unwrap();
    assert_eq!(book.retire_empty(4), Err(Error::Entitlement));
    let invalid = Margin {
        cash: MAX_CASH + 1,
        ..account(5, 0, [0, 0], [0, 0])
    };
    assert_eq!(book.record(&[empty, invalid]), Err(Error::Bounds));
    assert_eq!(book.record(&[empty, empty]), Err(Error::Cohort));
    assert_eq!(
        book.check(1, adverse, u8::MAX).unwrap().verdict,
        Verdict::Underfunded(4)
    );
    let join = Margin { id: 12, ..empty };
    book.record(&[join]).unwrap();
    book.retire_empty(12).unwrap();
    assert_eq!(
        book.check(1, adverse, u8::MAX).unwrap().verdict,
        Verdict::Underfunded(4)
    );
    book.record(&[empty]).unwrap();
    book.retire_empty(4).unwrap();
    assert_eq!(book.check(1, adverse, 0).unwrap().verdict, Verdict::Covered);
    assert!(book.check(2, adverse, 0).is_err());
    let mut invalid_region = adverse;
    invalid_region.markets[0].funding_low = 1;
    assert!(book.check(1, invalid_region, 0).is_err());
}

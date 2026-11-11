use financial_core::{margin::*, *};

fn isolated(id: u64, market: usize, cash: u64) -> Margin {
    Margin {
        id,
        mode: Mode::Isolated(market),
        cash,
        positions: [Position::default(); 2],
        reserved: 0,
    }
}
fn risks(market: usize, lower: u64, upper: u64, funding: i128) -> [Risk; 2] {
    let mut values = [Risk::default(); 2];
    values[market] = Risk {
        lower,
        upper,
        funding,
    };
    values
}

#[test]
fn funding_maker_candidate_has_no_synthetic_trader_fee_or_monotone_health_assumption() {
    for market in 0..2 {
        let mut maker = isolated(1, market, 500);
        maker.positions[market] = Position {
            lots: 3,
            virtual_scaled: -30_000 * SCALE,
            funding_checkpoint: 0,
            generation: 1,
        };
        let mut funding = [0; 2];
        funding[market] = SCALE;
        let mut admitted = Vec::new();
        for quantity in 1..=4 {
            let next = maker
                .maker_quote_candidate(market, 0, quantity, 10_010 * quantity, funding)
                .unwrap();
            assert_eq!(next.cash, 500);
            assert_eq!(next.positions[1 - market], Position::default());
            assert_eq!(next.positions[market].funding_checkpoint, SCALE);
            admitted.push(next.admissible(risks(market, 9900, 10100, SCALE)).is_ok());
            if quantity == 3 {
                assert_eq!(next.positions[market].lots, 0);
                assert_eq!(next.positions[market].generation, 2);
                assert_eq!(next.positions[market].virtual_scaled, 27 * SCALE);
                assert_eq!(
                    next.risk_equity(risks(market, 9900, 10100, SCALE)).unwrap(),
                    500 * SCALE
                );
                let reserved = Margin {
                    reserved: 501,
                    ..next
                };
                assert_eq!(
                    reserved.admissible(risks(market, 9900, 10100, SCALE)),
                    Err(Error::Health)
                );
            }
        }
        assert_eq!(admitted, [false, false, true, false]);
        assert_eq!(maker.positions[market].lots, 3);
        assert!(maker
            .maker_quote_candidate(1 - market, 0, 1, 10010, funding)
            .is_err());
    }
}

#[test]
fn isolated_btc_eth_share_accounting_without_sharing_cash() {
    for (market, price, gross, fee) in [(0, 60_000, 300_000, 60), (1, 30_000, 150_000, 30)] {
        let trader = isolated(0, market, 100_000);
        let makers = [isolated(1, market, 200_000), isolated(2, market, 200_000)];
        let (next, providers, paid) = route_candidate(
            trader,
            &makers,
            market,
            &[(2, 2 * price), (3, 3 * price)],
            0,
            [0, 0],
            0,
        )
        .unwrap();
        assert_eq!(
            (paid, next.cash, next.positions[market].lots),
            (fee, 100_000 - fee, 5)
        );
        assert_eq!(
            next.positions[market].virtual_scaled,
            -(gross as i128) * SCALE
        );
        assert_eq!(next.positions[1 - market], Position::default());
        assert_eq!(
            providers.iter().map(|root| root.cash).collect::<Vec<_>>(),
            [200_000, 200_000]
        );
        assert_eq!(
            providers[0].positions[market].virtual_scaled,
            2 * price as i128 * SCALE
        );
        assert_eq!(
            providers[1].positions[market].virtual_scaled,
            3 * price as i128 * SCALE
        );
        next.admissible(risks(market, price, price, 0)).unwrap();
        assert_eq!(
            next.risk_equity(risks(market, price, price, 0)).unwrap(),
            (100_000 - fee) as i128 * SCALE
        );
        assert_eq!(
            next.requirement(risks(market, price, price, 0), IM_BPS)
                .unwrap(),
            gross / 10
        );
        let (flat, flat_makers, close_fee) = route_candidate(
            next,
            &providers,
            market,
            &[(2, 2 * price), (3, 3 * price)],
            1,
            [0, 0],
            0,
        )
        .unwrap();
        assert_eq!(
            (
                flat.cash,
                flat.positions[market].lots,
                flat.positions[market].virtual_scaled
            ),
            (100_000 - 2 * fee, 0, 0)
        );
        assert_eq!(close_fee, fee);
        assert!(flat_makers
            .iter()
            .all(|root| root.positions[market].lots == 0
                && root.positions[market].virtual_scaled == 0));
    }
}

#[test]
fn pending_funding_fraction_and_generation_are_position_owned() {
    let root = isolated(0, 1, 100_000);
    let maker = isolated(1, 1, 100_000);
    let (long, short, _) =
        route_candidate(root, &[maker], 1, &[(3, 90_000)], 0, [0, 0], 0).unwrap();
    let long = long.accrued([999, 500_000_001]).unwrap();
    let short = short[0].accrued([999, 500_000_001]).unwrap();
    assert_eq!(long.positions[1].virtual_scaled, -90_001_500_000_003);
    assert_eq!(short.positions[1].virtual_scaled, 90_001_500_000_003);
    assert_eq!(long.positions[0], Position::default());
    assert_eq!(long.cash, 99_982);
    assert_eq!(long.positions[1].generation, 1);
    assert_eq!(long.accrued([999, 500_000_001]).unwrap(), long);
    let (flipped, _, _) =
        route_candidate(long, &[short], 1, &[(4, 120_000)], 1, [999, 500_000_001], 0).unwrap();
    assert_eq!(
        (flipped.positions[1].lots, flipped.positions[1].generation),
        (-1, 2)
    );
    assert_eq!(flipped.positions[1].virtual_scaled, 29_998_499_999_997);
}

#[test]
fn loss_only_credit_and_additive_reserve_remain_conservative() {
    let mut root = isolated(0, 0, 6_000);
    root.positions[0] = Position {
        lots: 1,
        virtual_scaled: -60_000 * SCALE,
        generation: 1,
        ..Position::default()
    };
    let bounds = risks(0, 60_000, 60_000, 0);
    assert!(root.admissible(bounds).is_ok());
    root.reserved = 1;
    assert_eq!(root.admissible(bounds), Err(Error::Health));
    root.positions[0].virtual_scaled += 10_000 * SCALE;
    assert_eq!(root.admissible(bounds), Err(Error::Health));
    root.reserved = 0;
    root.positions[0].virtual_scaled = -60_000 * SCALE;
    assert_eq!(
        root.risk_equity(risks(0, 59_000, 60_000, 0)).unwrap(),
        5_000 * SCALE
    );
    assert_eq!(
        root.admissible(risks(0, 59_000, 60_000, 0)),
        Err(Error::Health)
    );
}

#[test]
fn wrong_market_hidden_claim_duplicate_member_and_bound_reject() {
    let root = isolated(0, 0, 100_000);
    let maker = isolated(1, 0, 100_000);
    assert!(route_candidate(root, &[maker], 1, &[(1, 30_000)], 0, [0, 0], 0).is_err());
    assert!(route_candidate(root, &[root], 0, &[(1, 60_000)], 0, [0, 0], 0).is_err());
    assert!(route_candidate(
        root,
        &[maker, maker],
        0,
        &[(1, 60_000), (1, 60_000)],
        0,
        [0, 0],
        0
    )
    .is_err());
    let mut hidden = root;
    hidden.positions[1].virtual_scaled = 1;
    assert_eq!(hidden.validate(), Err(Error::Invariant));
    let mut excessive = root;
    excessive.cash = MAX_CASH + 1;
    assert_eq!(excessive.validate(), Err(Error::Bounds));
}

#[test]
fn cumulative_fee_rounding_does_not_change_with_position_adapter() {
    let trader = isolated(0, 1, 100_000);
    let maker = isolated(1, 1, 100_000);
    let (first, makers, first_fee) =
        route_candidate(trader, &[maker], 1, &[(1, 30_001)], 0, [0, 0], 0).unwrap();
    let (second, _, second_fee) =
        route_candidate(first, &makers, 1, &[(1, 30_001)], 0, [0, 0], 30_001).unwrap();
    assert_eq!((first_fee, second_fee, second.cash), (7, 6, 99_987));
}

#[test]
fn whole_account_admission_and_accrual_match_independent_integer_cases() {
    // Literal protocol scale and 10% IM. Expected values do not call risk_equity,
    // requirement, Participant or another production candidate.
    const UNIT: i128 = 1_000_000_000;
    let vectors = [
        ([3, -2], [-297 * UNIT, 190 * UNIT], [UNIT / 3, -UNIT / 7], [-UNIT, UNIT / 2]),
        ([0, 0], [500 * UNIT, -50 * UNIT - 1], [0, 0], [UNIT, -UNIT]),
        ([-7, 5], [710 * UNIT + 7, -490 * UNIT - 3], [-UNIT, UNIT], [2 * UNIT, -2 * UNIT]),
        ([1, 1], [-90 * UNIT, -95 * UNIT], [UNIT - 1, -UNIT + 1], [UNIT + 1, -UNIT - 1]),
    ];
    let bounds = [(99_u64, 103_u64), (97, 101)];
    for mode in [Mode::Cross, Mode::Isolated(0), Mode::Isolated(1)] {
        for (lots, virtuals, checkpoints, funding) in vectors {
            let positions = std::array::from_fn(|market| {
                if matches!(mode, Mode::Isolated(selected) if selected != market) {
                    Position::default()
                } else {
                    Position { lots: lots[market], virtual_scaled: virtuals[market],
                        funding_checkpoint: checkpoints[market], generation: 4 }
                }
            });
            let risks = std::array::from_fn(|market| Risk {
                lower: bounds[market].0, upper: bounds[market].1, funding: funding[market] });
            for reserved in [0_u64, 7, 131] {
                let mut requirement = reserved;
                let mut debt = 0_i128;
                let mut expected_positions = positions;
                for market in 0..2 {
                    if matches!(mode, Mode::Isolated(selected) if selected != market) { continue; }
                    let position = positions[market];
                    let accrued = position.virtual_scaled
                        - i128::from(position.lots) * (funding[market] - position.funding_checkpoint);
                    let price = if position.lots < 0 { bounds[market].1 } else { bounds[market].0 };
                    let claim = accrued + i128::from(position.lots) * i128::from(price) * UNIT;
                    debt += (-claim).max(0);
                    requirement += (position.lots.unsigned_abs() * bounds[market].1).div_ceil(10);
                    expected_positions[market].virtual_scaled = accrued;
                    expected_positions[market].funding_checkpoint = funding[market];
                }
                let minimum_cash = requirement + u64::try_from((debt + UNIT - 1) / UNIT).unwrap();
                for cash in [minimum_cash.saturating_sub(1), minimum_cash, minimum_cash + 1] {
                    let account = Margin { id: 3, mode, cash, reserved, positions };
                    let expected = if cash >= minimum_cash { Ok(()) } else { Err(Error::Health) };
                    assert_eq!(account.admissible(risks), expected, "{account:?}, {risks:?}");
                    assert_eq!(account.accrued(funding).unwrap(), Margin { positions: expected_positions, ..account });
                }
            }
        }
    }
}

#[test]
fn combined_admission_retains_invalid_bounds_and_forbidden_slot_rejection() {
    let base = isolated(0, 0, 100);
    for invalid in [Risk { lower: 0, upper: 1, funding: 0 },
        Risk { lower: 2, upper: 1, funding: 0 },
        Risk { lower: 1, upper: MAX_PRICE + 1, funding: 0 },
        Risk { lower: 1, upper: 1, funding: MAX_FUNDING + 1 }] {
        assert_eq!(base.admissible([invalid, Risk::default()]), Err(Error::Bounds));
    }
    let mut foreign = base;
    foreign.positions[1].virtual_scaled = 1;
    assert_eq!(foreign.admissible(risks(0, 1, 1, 0)), Err(Error::Invariant));
    assert_eq!(foreign.accrued([0, 0]), Err(Error::Invariant));
    let mut exhausted = base;
    exhausted.positions[0].lots = 1;
    exhausted.positions[0].virtual_scaled = MAX_SCALED;
    assert_eq!(exhausted.accrued([-1, 0]), Err(Error::Bounds));
    assert_eq!(base.accrued([MAX_FUNDING + 1, 0]), Err(Error::Bounds));
}

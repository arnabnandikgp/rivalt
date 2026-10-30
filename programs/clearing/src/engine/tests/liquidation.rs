use super::*;

#[test]
fn cross_certificate_checks_adverse_mixed_funding_corner() {
    let mut account = MarginAccount {
        mode: MODE_CROSS,
        isolated_market_index: CROSS_MARKET_SENTINEL,
        subaccount_index: 0,
        ..root(0, 1)
    };
    account.positions[0].lots = 1;
    account.positions[0].virtual_scaled = -1_000 * math::SCALE;
    account.positions[1].lots = -1;
    account.positions[1].virtual_scaled = 1_000 * math::SCALE;
    let risks = [math::margin::Risk {
        lower: 1_000,
        upper: 1_000,
        funding: 0,
    }; 2];
    let bounds = [[-math::SCALE, math::SCALE]; 2];
    let model = crate::engine::account::model(&account).unwrap();
    for funding in [-math::SCALE, math::SCALE] {
        assert_eq!(
            model
                .risk_equity(risks.map(|risk| math::margin::Risk { funding, ..risk }))
                .unwrap(),
            0
        );
    }
    // Both diagonal endpoints pass; BTC=+1, ETH=-1 loses two cash atoms.
    assert!(held_solvent(model, risks, bounds).is_err());
    account.cash = 2;
    held_solvent(
        crate::engine::account::model(&account).unwrap(),
        risks,
        bounds,
    )
    .unwrap();
}

#[test]
fn cross_certificate_includes_both_future_held_funding_endpoints() {
    let mut markets = [market(0), market(1)];
    for (index, market) in markets.iter_mut().enumerate() {
        market.oracle.funding_base = 100;
        market.oracle.premium_scaled = if index == 0 { 36_000 } else { -36_000 };
        market.oracle.sampled_at = 149;
        market.oracle.held_until = 155;
        market.oracle.held_slot = 200;
        market.oracle.held_epoch = 1;
    }
    // One elapsed second of a six-second hold: +/-10 now, +/-60 at end.
    assert_eq!(
        oracle::funding_bounds(2, &markets[0], &clock()).unwrap(),
        [110, 160]
    );
    assert_eq!(
        oracle::funding_bounds(2, &markets[1], &clock()).unwrap(),
        [40, 90]
    );
    assert_eq!(
        oracle::funding_bounds(0, &markets[0], &clock()).unwrap(),
        [0, 0]
    );
    let mut expired = clock();
    expired.slot = 200;
    assert_eq!(
        oracle::funding_bounds(2, &markets[0], &expired).unwrap(),
        [0, 0]
    );
}

#[test]
fn cross_liquidation_includes_other_market_funding_and_receiver_reservations() {
    let mut markets = [market(0), market(1)];
    markets[1].funding_index_scaled = 50 * math::SCALE;
    let mut target = MarginAccount {
        mode: MODE_CROSS,
        isolated_market_index: 255,
        subaccount_index: 0,
        ..root(0, 5_099)
    };
    target.positions[0] = Position {
        lots: 100,
        virtual_scaled: -100_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    target.positions[1] = Position {
        lots: 2,
        virtual_scaled: -2_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    let mut receiver = MarginAccount {
        mode: MODE_CROSS,
        isolated_market_index: 255,
        subaccount_index: 0,
        role: ROLE_RECEIVER,
        ..root(1, 300)
    };
    receiver.positions[1] = Position {
        lots: 1,
        virtual_scaled: -1_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    assert!(risk::candidate_optional(&target, &receiver, [Some(&markets[0]), None],
        2, 0, 1, 952, &clock()).is_err());
    let mut btc_only_target = target.clone();
    btc_only_target.positions[1] = Position::default();
    // Receiver obligations alone are sufficient to require ETH.
    assert!(risk::candidate_optional(&btc_only_target, &receiver, [Some(&markets[0]), None],
        2, 0, 1, 952, &clock()).is_err());
    let result = risk::candidate(
        &target,
        &receiver,
        markets.each_ref(),
        2,
        0,
        1,
        952,
        &clock(),
    )
    .unwrap();
    // Initial E=5,099-100=4,999; MM=5,100. After loss 48 and fee 1,
    // E=4,950 / MM=5,050: whole-account deficit strictly improves 101 -> 100.
    assert_eq!(
        (result.before, result.after, result.fee),
        (101 * math::SCALE, 100 * math::SCALE, 1)
    );
    assert_eq!((result.target.cash, result.receiver.cash), (5_098, 301));
    assert_eq!(
        result.target.positions[1].virtual_scaled,
        -2_100 * math::SCALE
    );
    assert_eq!(
        result.receiver.positions[1].virtual_scaled,
        -1_050 * math::SCALE
    );
    assert_eq!(result.target.positions[0].lots, 99);
    assert_eq!(result.receiver.positions[0].lots, 1);
    assert!(risk::candidate(
        &target,
        &receiver,
        markets.each_ref(),
        2,
        0,
        1,
        951,
        &clock()
    )
    .is_err());
    receiver.book.last_order_id = 1;
    receiver.book.orders[0] = StoredOrder {
        market_index: 1,
        order: crate::state::OrderRecord {
            state: crate::constants::orders::OPEN,
            id: 1,
            version: 1,
            lots: 1,
            limit: 1_000,
            fee_budget: 1,
            terms_epoch: 1,
            expiry_slot: 200,
            ..Default::default()
        },
        ..Default::default()
    };
    assert!(risk::candidate(
        &target,
        &receiver,
        markets.each_ref(),
        2,
        0,
        1,
        952,
        &clock()
    )
    .is_err());
    receiver.book = OrderBook::default();
    markets[1].valid_until = 100;
    assert!(risk::candidate(
        &target,
        &receiver,
        markets.each_ref(),
        2,
        0,
        1,
        952,
        &clock()
    )
    .is_err());
    assert_eq!(target.positions[1].funding_checkpoint_scaled, 0);
    assert_eq!(receiver.positions[1].funding_checkpoint_scaled, 0);
    assert_eq!((target.cash, receiver.cash), (5_099, 300));
}

#[test]
fn cross_post_fee_golden_rejects_worsening_deficit_despite_lower_requirement() {
    use crate::engine::account;
    let mut before = MarginAccount {
        mode: MODE_CROSS,
        isolated_market_index: 255,
        subaccount_index: 0,
        ..root(0, 80)
    };
    for position in &mut before.positions {
        *position = Position {
            lots: 10,
            virtual_scaled: -1_000 * math::SCALE,
            generation: 1,
            ..Default::default()
        };
    }
    let risks = [math::margin::Risk {
        lower: 100,
        upper: 100,
        funding: 0,
    }; 2];
    let before = account::model(&before).unwrap();
    let mut after = before;
    after.cash = 75;
    after.positions[0].lots = 4;
    after.positions[0].virtual_scaled = -430 * math::SCALE;
    assert_eq!(before.risk_equity(risks).unwrap(), 80 * math::SCALE);
    assert_eq!(before.requirement(risks, math::MM_BPS).unwrap(), 100);
    assert_eq!(after.risk_equity(risks).unwrap(), 45 * math::SCALE);
    assert_eq!(after.requirement(risks, math::MM_BPS).unwrap(), 70);
    assert_eq!(
        (
            before.deficit(risks).unwrap(),
            after.deficit(risks).unwrap()
        ),
        (20 * math::SCALE, 25 * math::SCALE)
    );
    // The admission golden uses explicit post-fee states; the preceding test
    // separately exercises the actual liquidation price/fee arithmetic.
    assert!(before.admit_reduction(&after, 0, risks).is_err());
}
fn clock() -> Clock {
    Clock {
        slot: 100,
        unix_timestamp: 150,
        ..Default::default()
    }
}
fn market(index: u8) -> Market {
    Market {
        schema_version: SCHEMA_VERSION,
        index,
        terms_epoch: 1,
        config_epoch: 1,
        observation_sequence: 3,
        reference_price: 1_000,
        lower: 1_000,
        upper: 1_000,
        valid_from: 90,
        valid_until: 200,
        gross_lots: 200,
        oracle: crate::state::OracleState {
            sampled_at: 149,
            source_deadline: 160,
            status: 2,
            ..Default::default()
        },
        ..Default::default()
    }
}
fn root(id: u16, cash: u64) -> MarginAccount {
    MarginAccount {
        schema_version: SCHEMA_VERSION,
        subaccount_index: 1,
        id,
        mode: MODE_ISOLATED,
        isolated_market_index: 0,
        cash,
        delegate_epoch: 1,
        ..Default::default()
    }
}

#[test]
fn actual_liquidation_candidate_cancels_risk_orders_only_with_post_fee_progress() {
    let markets = [market(0), market(1)];
    let mut target = root(0, 4_999);
    target.positions[0] = Position {
        lots: 100,
        virtual_scaled: -100_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    target.book.last_order_id = 1;
    target.book.orders[0].order = crate::state::OrderRecord {
        state: crate::constants::orders::OPEN,
        id: 1,
        version: 1,
        lots: 1,
        limit: 1_000,
        fee_budget: 1,
        terms_epoch: 1,
        expiry_slot: 200,
        ..Default::default()
    };
    let receiver = root(1, 100);
    assert!(risk::candidate(
        &target,
        &receiver,
        [&markets[0], &markets[1]],
        1,
        0,
        1,
        951,
        &clock()
    )
    .is_err());
    assert!(target.book.orders[0].order.active());
    let candidate = risk::candidate(
        &target,
        &receiver,
        [&markets[0], &markets[1]],
        1,
        0,
        1,
        952,
        &clock(),
    )
    .unwrap();
    assert_eq!(
        (candidate.fee, candidate.before, candidate.after),
        (1, math::SCALE, 0)
    );
    assert_eq!(
        candidate.target.book.orders[0].order.state,
        crate::constants::orders::INVALIDATED
    );
    assert_eq!(
        (candidate.target.cash, candidate.receiver.cash),
        (4_998, 101)
    );
    assert_eq!(candidate.gross_lots, 200);
    assert_eq!(candidate.target.positions[0].generation, 1);
    let mut maker = receiver.clone();
    maker.role = ROLE_MAKER;
    assert!(risk::candidate(
        &target,
        &maker,
        [&markets[0], &markets[1]],
        1,
        0,
        1,
        952,
        &clock()
    )
    .is_err());
}

#[test]
fn receiver_pending_order_reserve_and_absent_source_reject_atomically() {
    let mut markets = [market(0), market(1)];
    let mut target = root(0, 4_999);
    target.positions[0] = Position {
        lots: 100,
        virtual_scaled: -100_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    let mut receiver = root(1, 100);
    receiver.book.last_order_id = 1;
    receiver.book.orders[0].order = crate::state::OrderRecord {
        state: crate::constants::orders::OPEN,
        id: 1,
        version: 1,
        lots: 1,
        limit: 1_000,
        fee_budget: 1,
        terms_epoch: 1,
        expiry_slot: 200,
        ..Default::default()
    };
    assert!(risk::candidate(
        &target,
        &receiver,
        [&markets[0], &markets[1]],
        1,
        0,
        1,
        952,
        &clock()
    )
    .is_err());
    assert_eq!(receiver.cash, 100);
    receiver.book = OrderBook::default();
    markets[0].oracle.status = 0;
    assert!(risk::candidate(
        &target,
        &receiver,
        [&markets[0], &markets[1]],
        1,
        0,
        1,
        952,
        &clock()
    )
    .is_err());
}

// Exercise the current held-window admission helper with the original independent
// mixed-corner counterexample, rather than retaining a duplicate legacy algorithm.
fn held_solvent(
    model: math::margin::Margin,
    risks: [math::margin::Risk; 2],
    bounds: [[i128; 2]; 2],
) -> Result<()> {
    crate::instructions::account_cash::Snapshot {
        markets: [Some(Market::default()), Some(Market::default())],
        risks,
        bounds,
        clock: clock(),
    }
    .held_solvent(model)
}

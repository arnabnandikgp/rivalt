use super::*;
use crate::instructions::account_trading::authority::AccountGuard;
use financial_core::SCALE;

fn clock() -> Clock {
    Clock {
        slot: 100,
        unix_timestamp: 1006,
        ..Default::default()
    }
}
fn markets() -> [Market; 2] {
    [0u8, 1].map(|index| {
        let price = [60_000, 30_000][usize::from(index)];
        Market {
            schema_version: 3,
            index,
            lots_per_unit: [1_000_000, 100_000][usize::from(index)],
            cross_eligible: true,
            terms_epoch: 1,
            config_epoch: 1,
            observation_sequence: 7,
            reference_price: price,
            lower: price * 99 / 100,
            upper: price * 101 / 100,
            valid_from: 90,
            valid_until: 200,
            oracle: crate::state::OracleState {
                sampled_at: 1006,
                source_deadline: 1020,
                status: 2,
                held_epoch: 1,
                last_qualified: 1006,
                held_until: 1012,
                held_slot: 200,
                ..Default::default()
            },
            ..Default::default()
        }
    })
}
fn trader(cash: u64) -> MarginAccount {
    MarginAccount {
        schema_version: 3,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        owner: Pubkey::new_from_array([1; 32]),
        delegate_epoch: 1,
        cash,
        ..Default::default()
    }
}
fn makers() -> [MarginAccount; 2] {
    [1u8, 2].map(|id| MarginAccount {
        id: u16::from(id),
        mode: MODE_ISOLATED,
        isolated_market_index: 0,
        subaccount_index: 1,
        role: ROLE_MAKER,
        owner: Pubkey::new_from_array([id + 1; 32]),
        ..trader(1_000_000)
    })
}
fn leg() -> LiquidityRouteLeg {
    LiquidityRouteLeg {
        lots: 1,
        authority_epoch: 2,
        control_epoch: 3,
        shape_epoch: 4,
        depth_epoch: 5,
    }
}
fn canonical_quote(instance: u8, gross: u64) -> canonical::MakerQuoteResponse {
    canonical::MakerQuoteResponse {
        request: canonical::MakerQuoteRequest {
            version: 4,
            domain: [0; 32],
            market: Pubkey::default(),
            capital: Pubkey::default(),
            instance,
            authority_epoch: 2,
            control_epoch: 3,
            shape_epoch: 4,
            depth_epoch: 5,
            side: 0,
            lots: 1,
            inventory: 0,
            consumed: 0,
        },
        price_sequence: 8,
        anchor: 60_000,
        gross,
        remaining: 4095,
        valid_until_slot: 150,
        valid_until_time: 1012,
    }
}
fn intent() -> RouteIntent {
    RouteIntent {
        domain: [0; 32],
        terms_epoch: 1,
        config_epoch: 1,
        observation_sequence: 7,
        nonce: 0,
        start_slot: 90,
        expiry_slot: 150,
        side: 0,
        lots: 2,
        all_in_limit: 120_033,
        max_fee: 25,
        reduce_only: false,
        generation: None,
        legs: shared_legs(&[leg(), leg()]),
    }
}
fn fill(
    root: &MarginAccount,
    makers: &[MarginAccount; 2],
    markets: &[Market; 2],
    intent: &RouteIntent,
) -> Result<candidates::Candidate> {
    let market_views = [market_view(&markets[0])?, market_view(&markets[1])?];
    let quotes = [
        financial_quote(&canonical_quote(0, 60_003), &markets[0], &clock()),
        financial_quote(&canonical_quote(1, 60_005), &markets[0], &clock()),
    ];
    candidates::candidate_for_version(
        &v2::ClearingGroupV2::default(),
        &*root_view(root)?,
        &[*root_view(&makers[0])?, *root_view(&makers[1])?],
        &quotes,
        intent,
        None,
        &environment(&market_views, 0, &clock())?,
        &clock(),
        4,
    )
}

#[test]
fn canonical_two_leg_fill_has_independent_cash_claim_fee_and_health_boundaries() {
    let markets = markets();
    let mut trader = trader(100_000);
    let makers = makers();
    let result = fill(&trader, &makers, &markets, &intent()).unwrap();
    assert_eq!(
        (result.gross, result.fee, result.gross_lots),
        (120_008, 25, 4)
    );
    assert_eq!(result.trader.cash, 99_975);
    assert_eq!(result.trader.positions[0].lots, 2);
    assert_eq!(result.trader.positions[0].virtual_scaled, -120_008 * SCALE);
    assert_eq!(result.makers[0].positions[0].virtual_scaled, 60_003 * SCALE);
    assert_eq!(result.makers[1].positions[0].virtual_scaled, 60_005 * SCALE);
    assert!(result
        .makers
        .iter()
        .all(|maker| maker.cash == 1_000_000 && maker.positions[0].lots == -1));
    // 25 fee + (120008-2*59400) adverse claim + 2*60600/10 IM = 13353.
    trader.cash = 13_352;
    assert!(fill(&trader, &makers, &markets, &intent()).is_err());
    trader.cash = 13_353;
    assert!(fill(&trader, &makers, &markets, &intent()).is_ok());
    trader.cash -= 1;
    trader.positions[1].virtual_scaled = 1_000_000 * SCALE;
    assert!(
        fill(&trader, &makers, &markets, &intent()).is_err(),
        "positive unpaid ETH claim cannot cover BTC risk"
    );
}

#[test]
fn canonical_fill_rejects_unfunded_second_maker_and_every_signed_price_fee_limit() {
    let trader = trader(100_000);
    let mut makers = makers();
    makers[1].cash = 0;
    assert!(fill(&trader, &makers, &markets(), &intent()).is_err());
    assert_eq!(trader.cash, 100_000);
    assert_eq!(makers[0].positions[0].lots, 0); // pure candidate never commits a first leg
    makers[1].cash = 1_000_000;
    let mut limit = intent();
    limit.all_in_limit -= 1;
    assert!(fill(&trader, &makers, &markets(), &limit).is_err());
    limit = intent();
    limit.max_fee -= 1;
    assert!(fill(&trader, &makers, &markets(), &limit).is_err());
    makers[1].owner = trader.owner;
    assert!(fill(&trader, &makers, &markets(), &intent()).is_err());
}

#[test]
fn canonical_execution_accrues_the_entire_cross_account_before_admission() {
    let mut trader = trader(22_012);
    trader.positions[1] = v2::Position {
        lots: 2,
        virtual_scaled: -60_000 * SCALE,
        generation: 1,
        ..Default::default()
    };
    let mut markets = markets();
    markets[1].funding_index_scaled = 1_000 * SCALE;
    markets[1].oracle.funding_base = 1_000 * SCALE;
    // BTC requirement13353 + ETH (62000-2*29700) claim + 2*30300/10 IM =22013.
    assert!(fill(&trader, &makers(), &markets, &intent()).is_err());
    trader.cash += 1;
    let next = fill(&trader, &makers(), &markets, &intent()).unwrap();
    assert_eq!(next.trader.cash, 21_988);
    assert_eq!(next.trader.positions[1].virtual_scaled, -62_000 * SCALE);
    assert_eq!(
        next.trader.positions[1].funding_checkpoint_scaled,
        1_000 * SCALE
    );
}

#[test]
fn canonical_legs_keep_exact_wire_width_and_depth_changes_do_not_reset_consumption() {
    let guard = || AccountGuard {
        safety_epoch: 1,
        venue_terms_epoch: 1,
        nonce: 0,
        state_version: 0,
    };
    let route = LiquidityRouteIntent {
        guard: guard(),
        domain: [0; 32],
        terms_epoch: 1,
        config_epoch: 1,
        start_slot: 90,
        expiry_slot: 150,
        side: 0,
        lots: 2,
        all_in_limit: 120_033,
        max_fee: 25,
        reduce_only: true,
        generation: Some(1),
        legs: vec![leg(), leg()],
    };
    let order = LiquidityOrderExecution {
        guard: guard(),
        id: 1,
        version: 1,
        filled: 0,
        start_slot: 90,
        expiry_slot: 150,
        lots: 2,
        legs: vec![leg(), leg()],
    };
    let mut bytes = Vec::new();
    route.serialize(&mut bytes).unwrap();
    assert_eq!(bytes.len() + 8, 223);
    bytes.clear();
    order.serialize(&mut bytes).unwrap();
    assert_eq!(bytes.len() + 8, 172);
    let mut registration = MakerRegistration {
        schema_version: 4,
        venue: Pubkey::default(),
        market: Pubkey::default(),
        capital: Pubkey::default(),
        owner: Pubkey::default(),
        pricing_program: Pubkey::default(),
        program_data: Pubkey::default(),
        config: Pubkey::default(),
        price: Pubkey::default(),
        approved_hash: [0; 32],
        instance: 0,
        authority_epoch: 2,
        depth_epoch: 5,
        buy_consumed: 7,
        sell_consumed: 11,
        quarantined: false,
        bump: 0,
    };
    let mut quote = canonical_quote(0, 180_009);
    quote.request.consumed = 7;
    quote.request.lots = 3;
    consume(&mut registration, &quote).unwrap();
    assert_eq!(
        (registration.buy_consumed, registration.sell_consumed),
        (10, 11)
    );
    quote.price_sequence += 1;
    assert!(consume(&mut registration, &quote).is_err());
    assert_eq!(
        (registration.buy_consumed, registration.sell_consumed),
        (10, 11)
    );
    quote.request.consumed = 10;
    quote.request.lots = 1;
    consume(&mut registration, &quote).unwrap();
    assert_eq!(registration.buy_consumed, 11);
    let curve = CurveState {
        schema_version: 4,
        venue: Pubkey::default(),
        market: Pubkey::default(),
        capital: Pubkey::default(),
        controller: Pubkey::default(),
        owner: Pubkey::default(),
        updater: Pubkey::default(),
        updater_expiry_slot: 0,
        control_epoch: 3,
        shape_epoch: 4,
        domain: [0; 32],
        instance: 0,
        capability: 1,
        shape: canonical::LiquidityShape::default(),
        bump: 0,
    };
    validate_leg(&leg(), &registration, &curve).unwrap();
    for mutate in [
        (|leg: &mut LiquidityRouteLeg| leg.authority_epoch += 1) as fn(&mut LiquidityRouteLeg),
        |leg| leg.control_epoch += 1,
        |leg| leg.shape_epoch += 1,
        |leg| leg.depth_epoch += 1,
        |leg| leg.lots = 0,
        |leg| leg.lots = 4097,
    ] {
        let mut invalid = leg();
        mutate(&mut invalid);
        assert!(validate_leg(&invalid, &registration, &curve).is_err());
    }
}

#[test]
fn stored_canonical_subfills_charge_one_fee_prefix_and_release_reservations() {
    let mut markets = markets();
    let market_views = [
        market_view(&markets[0]).unwrap(),
        market_view(&markets[1]).unwrap(),
    ];
    let placement_environment = environment(&market_views, 0, &clock()).unwrap();
    let initial = root_view(&trader(100_000)).unwrap();
    let mut root = candidates::manage_candidate(
        &initial,
        &placement_environment,
        candidates::GroupOrderAction::Place {
            expected_id: 1,
            terms: crate::instructions::orders::OrderTerms {
                side: 0,
                lots: 2,
                limit: 61_000,
                fee_budget: 25,
                start_slot: 90,
                expiry_slot: 200,
                trigger: 0,
                threshold: 0,
                reduce_only: false,
                generation: 0,
            },
        },
        0,
    )
    .unwrap();
    assert!(root.reserved > 0);
    let mut maker = *root_view(&makers()[0]).unwrap();
    let mut total_fee = 0;
    for (filled, gross) in [60_003u64, 60_005].into_iter().enumerate() {
        let market_views = [
            market_view(&markets[0]).unwrap(),
            market_view(&markets[1]).unwrap(),
        ];
        let environment = environment(&market_views, 0, &clock()).unwrap();
        let (intent, index) = candidates::stored_intent(
            &v2::ClearingGroupV2::default(),
            &market_views[0],
            &root,
            OrderExecution {
                id: 1,
                version: 1,
                filled: filled as u64,
                observation_sequence: 7,
                start_slot: 90,
                expiry_slot: 150,
                lots: 1,
                legs: shared_legs(&[leg()]),
            },
            &clock(),
        )
        .unwrap();
        let quote = financial_quote(&canonical_quote(0, gross), &markets[0], &clock());
        let next = candidates::candidate_for_version(
            &v2::ClearingGroupV2::default(),
            &root,
            &[maker],
            &[quote],
            &intent,
            Some(index),
            &environment,
            &clock(),
            4,
        )
        .unwrap();
        assert_eq!(next.fee, if filled == 0 { 13 } else { 12 });
        total_fee += next.fee;
        markets[0].gross_lots = next.gross_lots;
        root = *next.trader;
        maker = next.makers[0].clone();
    }
    assert_eq!(total_fee, 25);
    assert_eq!(root.cash, 99_975);
    assert_eq!(root.positions[0].virtual_scaled, -120_008 * SCALE);
    assert_eq!(root.reserved, 0);
    assert_eq!(root.book.orders[0].order.notional, 120_008);
    assert_eq!(root.book.orders[0].order.fee_charged, 25);
    let mut custody = Custody {
        schema_version: 3,
        total_cash: 2_100_000,
        ..Default::default()
    };
    let mut ledger = MarketLedger {
        schema_version: 3,
        ..Default::default()
    };
    trading::split_fee(&mut custody, &mut ledger, 13).unwrap();
    trading::split_fee(&mut custody, &mut ledger, 12).unwrap();
    assert_eq!(
        (
            ledger.insurance,
            ledger.fees,
            ledger.insurance_fee_remainder
        ),
        (6, 19, 1)
    );
}

#[test]
fn borrowed_canonical_event_matches_owned_idl_with_distinct_roots_and_legs() {
    use crate::events::{
        LiquidityRouteExecuted, MarginAccountSnapshot, MarketLedgerSnapshot, MarketSnapshot,
    };
    use crate::state::liquidity::{ExecutedLeg, MakerRegistrationPayload};
    let markets = markets();
    let roots = [trader(100_000), makers()[0].clone(), makers()[1].clone()];
    let makers = [0u8, 1].map(|instance| {
        let mut value = MakerRegistration::try_from_slice(&[0; 325]).unwrap();
        value.schema_version = 4;
        value.instance = instance;
        value.capital = Pubkey::new_from_array([instance + 21; 32]);
        value.buy_consumed = 11 + u64::from(instance);
        value.sell_consumed = 31 + u64::from(instance);
        value.authority_epoch = 41 + u64::from(instance);
        value.depth_epoch = 51 + u64::from(instance);
        value
    });
    let legs = [0u8, 1].map(|instance| ExecutedLeg {
        registration: Pubkey::new_from_array([instance + 71; 32]),
        capital: makers[usize::from(instance)].capital,
        instance,
        lots: 2 + u64::from(instance),
        gross: 120_000 + u64::from(instance),
        price_sequence: 81 + u64::from(instance),
        authority_epoch: 41 + u64::from(instance),
        control_epoch: 91 + u64::from(instance),
        shape_epoch: 101 + u64::from(instance),
        depth_epoch: 51 + u64::from(instance),
        consumed_before: 9,
        consumed_after: 11 + u64::from(instance),
    });
    let ledger = MarketLedgerSnapshot {
        ledger: Pubkey::new_unique(),
        market: Pubkey::new_unique(),
        market_index: 0,
        settlement: 101,
        insurance: 102,
        fees: 103,
        insurance_fee_remainder: 3,
        version: 105,
    };
    let owned = LiquidityRouteExecuted {
        venue: roots[0].venue,
        sequence: 110,
        slot: 111,
        market: ledger.market,
        market_state: MarketSnapshot::from(&markets[0]),
        other_market_state: MarketSnapshot::from(&markets[1]),
        nonce: 112,
        side: 0,
        lots: 5,
        gross_quote: 240_001,
        fee: 49,
        insurance_credit: 12,
        retained_fee: 37,
        carry_before: 2,
        carry_after: 3,
        ledger: ledger.clone(),
        order_id: 113,
        order_version: 114,
        root_states: roots.iter().map(MarginAccountSnapshot::from).collect(),
        maker_states: makers
            .iter()
            .map(MakerRegistrationPayload::from)
            .collect(),
        total_cash: 115,
        liability_versions: [116, 117],
        legs: legs.to_vec(),
    };
    let view = commit::RouteEventView {
        venue: owned.venue,
        sequence: owned.sequence,
        slot: owned.slot,
        market: owned.market,
        market_state: &markets[0],
        other_market_state: &markets[1],
        nonce: owned.nonce,
        side: owned.side,
        lots: owned.lots,
        gross_quote: owned.gross_quote,
        fee: owned.fee,
        insurance_credit: owned.insurance_credit,
        retained_fee: owned.retained_fee,
        carry_before: owned.carry_before,
        carry_after: owned.carry_after,
        ledger,
        order_id: owned.order_id,
        order_version: owned.order_version,
        root_states: roots.iter().collect(),
        maker_states: makers.iter().collect(),
        total_cash: owned.total_cash,
        liability_versions: owned.liability_versions,
        legs: legs.to_vec(),
    };
    fn bytes<T: AnchorSerialize>(value: &T) -> Vec<u8> {
        let mut encoded = Vec::new();
        value.serialize(&mut encoded).unwrap();
        encoded
    }
    let expected = bytes(&owned);
    assert_eq!(bytes(&view), expected);
    let swapped = commit::RouteEventView {
        maker_states: makers.iter().rev().collect(),
        ..view
    };
    assert_ne!(bytes(&swapped), expected);
}

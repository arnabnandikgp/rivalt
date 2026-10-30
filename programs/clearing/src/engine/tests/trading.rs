use super::*;
use crate::engine::routes::ExecutionQuote;
use crate::{
    instructions::{OrderExecution, OrderTerms, RouteIntent, RouteLeg},
    state::OracleState,
};

fn clock() -> Clock {
    Clock {
        slot: 100,
        unix_timestamp: 1007,
        ..Clock::default()
    }
}
fn group() -> Venue {
    Venue {
        schema_version: SCHEMA_VERSION,
        profile_version: PROFILE_VERSION,
        domain: [7; 32],
        market_count: 2,
        ..Venue::default()
    }
}
fn market(index: u8) -> Market {
    let reference = if index == 0 { 60_000 } else { 30_000 };
    Market {
        schema_version: SCHEMA_VERSION,
        venue: Pubkey::new_from_array([9; 32]),
        index,
        lots_per_unit: if index == 0 { 1_000_000 } else { 100_000 },
        terms_epoch: 1,
        config_epoch: 1,
        observation_sequence: 1,
        reference_price: reference,
        lower: reference * 99 / 100,
        upper: reference * 101 / 100,
        valid_from: 90,
        valid_until: 200,
        oracle: OracleState {
            sampled_at: 1006,
            source_deadline: 1020,
            status: 2,
            held_epoch: 1,
            last_qualified: 1006,
            held_until: 1012,
            held_slot: 200,
            ..OracleState::default()
        },
        ..Market::default()
    }
}
fn root(id: u16, market: u8, role: u8) -> MarginAccount {
    MarginAccount {
        schema_version: SCHEMA_VERSION,
        venue: Pubkey::new_from_array([9; 32]),
        owner: Pubkey::new_from_array([id as u8 + 1; 32]),
        portfolio: Pubkey::new_from_array([id as u8 + 10; 32]),
        subaccount_index: 1,
        id,
        mode: MODE_ISOLATED,
        isolated_market_index: market,
        role,
        cash: 1_000_000,
        delegate_epoch: 1,
        ..MarginAccount::default()
    }
}
fn intent(
    market: &Market,
    trader: &MarginAccount,
    side: u8,
    lots: u64,
    parts: &[u64],
) -> RouteIntent {
    RouteIntent {
        domain: [7; 32],
        terms_epoch: 1,
        config_epoch: 1,
        observation_sequence: market.observation_sequence,
        nonce: trader.nonce,
        start_slot: 90,
        expiry_slot: 150,
        side,
        lots,
        all_in_limit: if side == 0 {
            lots * market.reference_price * 11 / 10
        } else {
            lots * market.reference_price * 9 / 10
        },
        max_fee: 1000,
        reduce_only: false,
        generation: None,
        legs: parts
            .iter()
            .map(|lots| RouteLeg {
                lots: *lots,
                quote_epoch: 1,
                authority_epoch: 1,
            })
            .collect(),
    }
}
fn quote(id: u8, intent: &RouteIntent, lots: u64, price: u64) -> ExecutionQuote {
    ExecutionQuote {
        version: 4,
        maker_id: id,
        side: intent.side,
        lots,
        gross_quote: lots * price,
        remaining: 100,
        quote_epoch: 1,
        authority_epoch: 1,
        terms_epoch: 1,
        market_config_epoch: 1,
        start_slot: 90,
        expiry_slot: 200,
        consumed_before: 0,
        reference_price: price,
    }
}
fn terms(lots: u64) -> OrderTerms {
    OrderTerms {
        side: 0,
        lots,
        limit: 30_500,
        fee_budget: 100,
        start_slot: 90,
        expiry_slot: 200,
        trigger: 0,
        threshold: 0,
        reduce_only: false,
        generation: 0,
    }
}
fn execution(
    id: u64,
    version: u64,
    filled: u64,
    lots: u64,
    observation_sequence: u64,
) -> OrderExecution {
    OrderExecution {
        id,
        version,
        filled,
        observation_sequence,
        start_slot: 90,
        expiry_slot: 150,
        lots,
        legs: vec![RouteLeg {
            lots,
            quote_epoch: 1,
            authority_epoch: 1,
        }],
    }
}
fn bytes(root: &MarginAccount) -> Vec<u8> {
    let mut bytes = Vec::new();
    root.serialize(&mut bytes).unwrap();
    bytes
}

#[test]
fn both_markets_atomic_split_and_zero_provider_fee() {
    for (index, expected_fee) in [(0, 60), (1, 30)] {
        let market = market(index);
        let trader = root(0, index, 0);
        let makers = [root(1, index, 1), root(2, index, 1)];
        let intent = intent(&market, &trader, 0, 5, &[2, 3]);
        let quotes = [
            quote(0, &intent, 2, market.reference_price),
            quote(1, &intent, 3, market.reference_price),
        ];
        let result = routes::candidate(
            &group(),
            &market,
            &trader,
            &makers,
            &quotes,
            &intent,
            None,
            0,
            &clock(),
        )
        .unwrap();
        assert_eq!(
            (
                result.fee,
                result.trader.cash,
                result.trader.nonce,
                result.gross_lots
            ),
            (expected_fee, 1_000_000 - expected_fee, 1, 10)
        );
        assert_eq!(
            (
                result.trader.positions[index as usize].lots,
                result.trader.positions[index as usize].generation
            ),
            (5, 1)
        );
        assert_eq!(result.trader.positions[1 - index as usize].lots, 0);
        assert_eq!(result.trader.state_version, 1);
        assert!(result
            .makers
            .iter()
            .all(|maker| maker.cash == 1_000_000 && maker.state_version == 1));
        assert_eq!(trader.nonce, 0); // Candidate evaluation never mutates its inputs.
    }
}

#[test]
fn all_in_nonce_owner_alias_and_second_leg_health_are_atomic() {
    let market = market(1);
    let trader = root(0, 1, 0);
    let makers = [root(1, 1, 1), root(2, 1, 1)];
    let request = intent(&market, &trader, 0, 5, &[2, 3]);
    let quotes = [quote(0, &request, 2, 30_000), quote(1, &request, 3, 30_000)];
    let before = bytes(&trader);
    for change in 0..5 {
        let mut request = request.clone();
        let mut providers = makers.clone();
        match change {
            0 => request.all_in_limit = 150_029,
            1 => request.nonce = 1,
            2 => providers[1].owner = trader.owner,
            3 => providers[1].cash = 1,
            _ => providers[1].isolated_market_index = 0,
        }
        assert!(routes::candidate(
            &group(),
            &market,
            &trader,
            &providers,
            &quotes,
            &request,
            None,
            0,
            &clock()
        )
        .is_err());
        assert_eq!(bytes(&trader), before);
    }
    let mut repeated = quotes.clone();
    repeated[1].maker_id = 0;
    assert!(routes::candidate(
        &group(),
        &market,
        &trader,
        &makers,
        &repeated,
        &request,
        None,
        0,
        &clock()
    )
    .is_err());
}

#[test]
fn partial_order_reserves_fees_and_versioned_replacement() {
    let mut market = market(1);
    let trader = root(0, 1, 0);
    let maker = root(1, 1, 1);
    let placed = book::place(&trader, &market, 0, 100, 1, terms(2)).unwrap();
    assert_eq!(placed.reserved, 7760); // 2 * (30500-29700+3030) + 100.
    let (request, index) = routes::stored_intent(
        &group(),
        &market,
        &placed,
        execution(1, 1, 0, 1, 1),
        &clock(),
    )
    .unwrap();
    let quotes = [quote(0, &request, 1, 30_001)];
    let first = routes::candidate(
        &group(),
        &market,
        &placed,
        &[maker],
        &quotes,
        &request,
        Some(index),
        0,
        &clock(),
    )
    .unwrap();
    assert_eq!(
        (
            first.fee,
            first.trader.reserved,
            first.trader.book.orders[0].order.notional
        ),
        (7, 3923, 30_001)
    );
    assert!(routes::stored_intent(
        &group(),
        &market,
        &first.trader,
        execution(1, 1, 0, 1, 1),
        &clock()
    )
    .is_err());
    market.gross_lots = first.gross_lots;
    let mut changed = terms(2);
    changed.limit = 30_600;
    let replaced = book::replace(&first.trader, &market, 0, 100, 1, 1, changed).unwrap();
    assert_eq!(
        (
            replaced.book.orders[0].order.version,
            replaced.book.orders[0].order.filled,
            replaced.book.orders[0].order.fee_charged
        ),
        (2, 1, 7)
    );
    assert_eq!(replaced.reserved, 4023);
    assert!(book::replace(&replaced, &market, 0, 100, 1, 1, changed).is_err());
    let (request, index) = routes::stored_intent(
        &group(),
        &market,
        &replaced,
        execution(1, 2, 1, 1, 1),
        &clock(),
    )
    .unwrap();
    let second = routes::candidate(
        &group(),
        &market,
        &replaced,
        &first.makers,
        &[quote(0, &request, 1, 30_001)],
        &request,
        Some(index),
        0,
        &clock(),
    )
    .unwrap();
    assert_eq!(
        (second.fee, second.trader.cash, second.trader.reserved),
        (6, 999_987, 0)
    );
    assert_eq!(
        (
            second.trader.book.orders[0].order.fee_charged,
            second.trader.book.orders[0].order.state
        ),
        (13, crate::constants::orders::FILLED)
    );
}

fn long() -> MarginAccount {
    let mut trader = root(0, 1, 0);
    trader.positions[1] = Position {
        lots: 5,
        virtual_scaled: -150_000 * math::SCALE,
        generation: 1,
        ..Position::default()
    };
    trader
}
fn protection_terms() -> (OrderTerms, OrderTerms) {
    let base = OrderTerms {
        side: 1,
        lots: 5,
        limit: 27_000,
        fee_budget: 100,
        start_slot: 90,
        expiry_slot: 200,
        trigger: 1,
        threshold: 31_000,
        reduce_only: true,
        generation: 1,
    };
    (
        base,
        OrderTerms {
            trigger: 2,
            threshold: 29_000,
            ..base
        },
    )
}

#[test]
fn tpsl_is_existing_position_bound_and_shared_quantity_survives_partial_fill() {
    let mut market = market(1);
    market.gross_lots = 10;
    let (tp, sl) = protection_terms();
    assert!(book::protect(&root(0, 1, 0), &market, 0, 100, 1, tp, sl).is_err());
    let protected = book::protect(&long(), &market, 0, 100, 1, tp, sl).unwrap();
    assert_eq!(protected.book.protections[0].protection.remaining, 5);
    assert!(routes::stored_intent(
        &group(),
        &market,
        &protected,
        execution(1, 1, 0, 2, 1),
        &clock()
    )
    .is_err());
    market.reference_price = 31_000;
    market.lower = 30_690;
    market.upper = 31_310;
    market.observation_sequence = 2;
    let (request, index) = routes::stored_intent(
        &group(),
        &market,
        &protected,
        execution(1, 1, 0, 2, 2),
        &clock(),
    )
    .unwrap();
    let mut maker = root(1, 1, 1);
    maker.positions[1] = Position {
        lots: -5,
        virtual_scaled: 150_000 * math::SCALE,
        generation: 1,
        ..Position::default()
    };
    let first = routes::candidate(
        &group(),
        &market,
        &protected,
        &[maker],
        &[quote(0, &request, 2, 31_000)],
        &request,
        Some(index),
        0,
        &clock(),
    )
    .unwrap();
    assert_eq!(
        (
            first.fee,
            first.trader.positions[1].lots,
            first.trader.book.protections[0].protection.remaining
        ),
        (13, 3, 3)
    );
    assert_eq!(
        book::eligible(&first.trader, &first.trader.book.orders[1].order).unwrap(),
        3
    );
    market.reference_price = 29_000;
    market.lower = 28_710;
    market.upper = 29_290;
    market.observation_sequence = 3;
    market.gross_lots = first.gross_lots;
    assert!(routes::stored_intent(
        &group(),
        &market,
        &first.trader,
        execution(2, 1, 0, 4, 3),
        &clock()
    )
    .is_err());
    let (request, index) = routes::stored_intent(
        &group(),
        &market,
        &first.trader,
        execution(2, 1, 0, 3, 3),
        &clock(),
    )
    .unwrap();
    let second = routes::candidate(
        &group(),
        &market,
        &first.trader,
        &first.makers,
        &[quote(0, &request, 3, 29_000)],
        &request,
        Some(index),
        0,
        &clock(),
    )
    .unwrap();
    assert_eq!(
        (
            second.fee,
            second.trader.positions[1].lots,
            second.trader.positions[1].virtual_scaled
        ),
        (18, 0, -1000 * math::SCALE)
    );
    assert_eq!(second.trader.reserved, 0);
    assert!(second
        .trader
        .book
        .orders
        .iter()
        .all(|entry| !entry.order.active()));
    assert_eq!(second.trader.book.protections[0].protection.remaining, 0);
}

#[test]
fn protections_reject_market_generation_and_surplus_slots() {
    let market = market(1);
    let (tp, sl) = protection_terms();
    let first = book::protect(&long(), &market, 0, 100, 1, tp, sl).unwrap();
    let second = book::protect(&first, &market, 0, 100, 3, tp, sl).unwrap();
    assert_eq!(
        second
            .book
            .orders
            .iter()
            .filter(|entry| entry.order.active())
            .count(),
        4
    );
    assert!(book::place(&second, &market, 0, 100, 5, terms(1)).is_err());
    assert!(book::protect(&second, &market, 0, 100, 5, tp, sl).is_err());
    let mut wrong = first.clone();
    wrong.book.protections[0].market_index = 0;
    assert!(book::validate(&wrong).is_err());
    let mut reversed = first;
    reversed.positions[1].lots = -2;
    reversed.positions[1].generation = 2;
    book::refresh(&mut reversed, &market, 100, true).unwrap();
    assert!(reversed
        .book
        .orders
        .iter()
        .all(|entry| !entry.order.active()));
    assert_eq!(reversed.reserved, 0);
    let mut changed = tp;
    changed.generation = 2;
    assert!(book::protect(&long(), &market, 0, 100, 1, changed, sl).is_err());
}

#[test]
fn stale_cancel_reprices_survivors_and_pending_funding_blocks_admission() {
    let market = market(1);
    let trader = root(0, 1, 0);
    let first = book::place(&trader, &market, 0, 100, 1, terms(1)).unwrap();
    let second = book::place(&first, &market, 0, 100, 2, terms(1)).unwrap();
    let cancelled = book::cancel(&second, &market, 100, 1, 1, false, false).unwrap();
    assert_eq!(cancelled.reserved, 130_599); // 30500-1 + ceil(1e6/10) + 100.
    assert!(book::cancel(&cancelled, &market, 100, 1, 1, false, false).is_err());
    let mut debtor = long();
    debtor.cash = 21_000; // 15,150 position IM + 1,500 loss + 3,930 new reserve.
    assert!(book::place(&debtor, &market, 0, 100, 1, terms(1)).is_ok());
    assert!(book::place(&debtor, &market, 1000 * math::SCALE, 100, 1, terms(1)).is_err());
}

#[test]
fn causal_funding_prefix_recovery_and_stale_paths_are_market_local() {
    use financial_core::oracle::Bounds;
    let mut initial = market(1);
    initial.oracle = OracleState::default();
    initial.funding_time = 0;
    let bounds = Bounds {
        reference: 30_000,
        lower: 29_700,
        upper: 30_300,
        normal: true,
        deadline: 1020,
    };
    let mut time = Clock {
        slot: 100,
        unix_timestamp: 1000,
        ..Clock::default()
    };
    let first = oracle::sample_candidate(
        1,
        &initial,
        &time,
        Some(bounds),
        [1; 4],
        Some((200, 5_990_000, 6_030_000, 1000)),
    )
    .unwrap();
    assert_eq!(
        (
            first.oracle.premium_scaled,
            first.oracle.status,
            first.funding_index_scaled
        ),
        (50 * math::SCALE, 1, 0)
    );
    time.unix_timestamp = 1006;
    time.slot = 106;
    let recovered = oracle::sample_candidate(
        1,
        &first,
        &time,
        Some(bounds),
        [2; 4],
        Some((200, 5_990_000, 6_030_000, 1000)),
    )
    .unwrap();
    assert_eq!(
        (
            recovered.oracle.status,
            recovered.funding_index_scaled,
            recovered.oracle.covered_seconds
        ),
        (2, 83_333_333, 6)
    );
    time.unix_timestamp = 1007;
    let mut frequent = recovered.clone();
    oracle::materialize(1, &mut frequent, &time).unwrap();
    assert_eq!(frequent.funding_index_scaled, 97_222_221);
    time.unix_timestamp = 1008;
    assert_eq!(oracle::effective(1, &frequent, &time).unwrap(), 111_111_110);
    assert_eq!(
        oracle::effective(1, &recovered, &time).unwrap(),
        111_111_110
    );
    frequent.config_epoch += 1;
    let old_time = frequent.funding_time;
    oracle::materialize(1, &mut frequent, &time).unwrap();
    assert_eq!(
        (frequent.funding_index_scaled, frequent.funding_time),
        (97_222_221, old_time)
    );
    let degraded = oracle::sample_candidate(1, &frequent, &time, None, [2; 4], None).unwrap();
    assert_eq!(
        (
            degraded.oracle.status,
            degraded.oracle.source_deadline,
            degraded.funding_index_scaled
        ),
        (0, 1020, 97_222_221)
    );
    assert!(oracle::action(&degraded, &time, false).is_err());
    assert_eq!(oracle::feed_indexes(0).unwrap(), [0, 1, 2, 3]);
    assert_eq!(oracle::feed_indexes(1).unwrap(), [4, 1, 5, 3]);
    assert!(oracle::feed_indexes(2).is_err());
    let mut untouched = market(0);
    untouched.funding_index_scaled = 123;
    assert_eq!(untouched.funding_index_scaled, 123);
    time.unix_timestamp = 1040;
    let gap = oracle::sample_candidate(1, &recovered, &time, None, [2; 4], None).unwrap();
    assert_eq!(
        (gap.oracle.outcome, gap.funding_index_scaled),
        (3, 83_333_333)
    );
}

#[test]
fn custody_sampling_cannot_accrue_funding_before_activation() {
    let mut market = market(1);
    market.oracle.premium_scaled = 50 * math::SCALE;
    market.oracle.funding_base = 0;
    let time = clock();
    assert_eq!(oracle::effective(0, &market, &time).unwrap(), 0);
    let bounds = financial_core::oracle::Bounds {
        reference: 30_000,
        lower: 29_700,
        upper: 30_300,
        normal: true,
        deadline: 1020,
    };
    let mut next_time = time;
    next_time.unix_timestamp = 1008;
    let next = oracle::sample_candidate(
        0,
        &market,
        &next_time,
        Some(bounds),
        [1; 4],
        Some((200, 5_990_000, 6_030_000, 1000)),
    )
    .unwrap();
    assert_eq!(
        (next.funding_index_scaled, next.oracle.covered_seconds),
        (0, 0)
    );
}

#[test]
fn event_snapshots_preserve_account_payload_without_discriminator() {
    fn serialized<T: AnchorSerialize>(value: &T) -> Vec<u8> {
        let mut bytes = Vec::new();
        value.serialize(&mut bytes).unwrap();
        bytes
    }
    let root = long();
    assert_eq!(
        serialized(&root),
        serialized(&crate::events::MarginAccountSnapshot::from(&root))
    );
    let market = market(1);
    assert_eq!(
        serialized(&market),
        serialized(&crate::events::MarketSnapshot::from(&market))
    );
    let registration = crate::state::liquidity::MakerRegistration {
        schema_version: 4,
        owner: root.owner,
        venue: root.venue,
        buy_consumed: 123,
        sell_consumed: 456,
        approved_hash: [31; 32],
        market: Pubkey::new_from_array([32; 32]),
        capital: Pubkey::new_from_array([33; 32]),
        pricing_program: Pubkey::new_from_array([34; 32]),
        program_data: Pubkey::new_from_array([35; 32]),
        config: Pubkey::new_from_array([36; 32]),
        price: Pubkey::new_from_array([37; 32]),
        instance: 1,
        authority_epoch: 2,
        depth_epoch: 3,
        quarantined: false,
        bump: 254,
    };
    assert_eq!(
        serialized(&registration),
        serialized(&crate::state::liquidity::MakerRegistrationPayload::from(
            &registration
        ))
    );
}

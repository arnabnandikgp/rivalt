use super::*;
use crate::engine::account::{live_order_authority, trade_authority};

fn margin_root() -> MarginAccount {
    MarginAccount {
        schema_version: SCHEMA_VERSION,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        owner: Pubkey::new_from_array([1; 32]),
        delegate_epoch: 1,
        cash: 1_000,
        ..MarginAccount::default()
    }
}

#[test]
fn owner_and_exclusive_delegate_authority_are_root_scoped() {
    let mut root = margin_root();
    let delegate = Pubkey::new_from_array([2; 32]);
    assert_eq!(trade_authority(&root, root.owner, 100).unwrap(), 0);
    assert!(trade_authority(&root, delegate, 100).is_err());
    root.delegate = delegate;
    root.delegate_expiry_slot = 101;
    root.delegate_epoch = 2;
    assert_eq!(trade_authority(&root, delegate, 100).unwrap(), 2);
    assert!(trade_authority(&root, delegate, 101).is_err());
    assert!(live_order_authority(&root, 2, 100));
    assert!(!live_order_authority(&root, 2, 101));
    assert!(live_order_authority(&root, 0, 101));
    root.delegate_epoch = 3;
    assert!(!live_order_authority(&root, 2, 100));
    assert!(trade_authority(
        &MarginAccount {
            id: 1,
            ..margin_root()
        },
        delegate,
        100
    )
    .is_err());
}

#[test]
fn malformed_authority_and_cross_maker_identity_reject() {
    let mut root = margin_root();
    root.role = ROLE_MAKER;
    assert!(model(&root).is_err());
    root.role = ROLE_TRADER;
    root.delegate_epoch = 0;
    assert!(model(&root).is_err());
    root.delegate_epoch = 1;
    root.delegate_expiry_slot = 100;
    assert!(model(&root).is_err());
    root.delegate = root.owner;
    assert!(model(&root).is_err());
    root.delegate = Pubkey::new_unique();
    assert!(model(&root).is_ok());
}

#[test]
fn owner_grants_revoke_old_intents_and_orders_without_moving_cash_or_fractions() {
    use crate::engine::book;
    let mut root = margin_root();
    root.cash = 1_000_000;
    root.positions[0].virtual_scaled = -300_000_000;
    let delegate = Pubkey::new_from_array([2; 32]);
    let mut granted = authority::candidate(&root, root.owner, delegate, 200, 100).unwrap();
    assert_eq!(
        (granted.delegate_epoch, granted.nonce, granted.state_version),
        (2, 1, 1)
    );
    let markets = book_markets();
    granted = book::place_with_environment(
        &granted,
        &book_environment(&markets, 0),
        1,
        order_terms(0),
        0,
    )
    .unwrap();
    granted = book::place_with_environment(
        &granted,
        &book_environment(&markets, 1),
        2,
        order_terms(1),
        2,
    )
    .unwrap();
    let revoked = authority::candidate(&granted, root.owner, Pubkey::default(), 0, 100).unwrap();
    assert_eq!((revoked.delegate_epoch, revoked.nonce), (3, 2));
    assert!(revoked.book.orders[0].order.active());
    assert!(!revoked.book.orders[1].order.active());
    assert_eq!(revoked.reserved, 76_800);
    assert_eq!(revoked.cash, root.cash);
    assert_eq!(revoked.positions[0].virtual_scaled, -300_000_000);
    let regranted = authority::candidate(&revoked, root.owner, delegate, 201, 100).unwrap();
    assert_eq!((regranted.delegate_epoch, regranted.nonce), (4, 3));
    assert!(!regranted.book.orders[1].order.active());
    assert!(!live_order_authority(&regranted, 2, 100));
    assert!(authority::candidate(&granted, delegate, delegate, 201, 100).is_err());
    assert!(authority::candidate(&root, root.owner, root.owner, 200, 100).is_err());
    assert!(authority::candidate(&root, root.owner, delegate, 100, 100).is_err());
    assert!(authority::candidate(&root, root.owner, delegate, 216_101, 100).is_err());
    assert!(authority::candidate(&root, root.owner, Pubkey::default(), 200, 100).is_err());
    assert!(authority::candidate(&granted, root.owner, delegate, 200, 100).is_err());
    assert!(authority::candidate(
        &MarginAccount {
            nonce: u64::MAX,
            ..root.clone()
        },
        root.owner,
        delegate,
        200,
        100
    )
    .is_err());
    assert!(authority::candidate(
        &MarginAccount {
            delegate_epoch: u64::MAX,
            ..root.clone()
        },
        root.owner,
        delegate,
        200,
        100
    )
    .is_err());
    // A grant on dormant cash does not block an admissible owner cash exit.
    let dormant = authority::candidate(&margin_root(), root.owner, delegate, 200, 100).unwrap();
    assert!(crate::engine::account::model(&dormant).is_ok());
}

#[test]
fn stored_execution_checks_actual_market_and_live_delegate_before_quotes() {
    use crate::instructions::OrderExecution;
    let markets = book_markets();
    let mut root = margin_root();
    root.cash = 1_000_000;
    let delegate = Pubkey::new_from_array([2; 32]);
    let granted = authority::candidate(&root, root.owner, delegate, 110, 100).unwrap();
    let order = book::place_with_environment(
        &granted,
        &book_environment(&markets, 1),
        1,
        order_terms(1),
        2,
    )
    .unwrap();
    let execution = || OrderExecution {
        id: 1,
        version: 1,
        filled: 0,
        lots: 1,
        observation_sequence: 1,
        start_slot: 100,
        expiry_slot: 150,
        legs: vec![],
    };
    let group = Venue::default();
    let clock = Clock {
        slot: 109,
        ..Clock::default()
    };
    assert!(routes::stored_intent(&group, &markets[1], &order, execution(), &clock).is_ok());
    assert!(routes::stored_intent(&group, &markets[0], &order, execution(), &clock).is_err());
    assert!(routes::stored_intent(
        &group,
        &markets[1],
        &order,
        execution(),
        &Clock { slot: 110, ..clock }
    )
    .is_err());
    let revoked = authority::candidate(&order, root.owner, Pubkey::default(), 0, 109).unwrap();
    assert!(routes::stored_intent(&group, &markets[1], &revoked, execution(), &clock).is_err());
}

fn book_markets() -> [Market; 2] {
    [0u8, 1].map(|index| {
        let reference = [60_000, 30_000][usize::from(index)];
        Market {
            schema_version: SCHEMA_VERSION,
            index,
            lots_per_unit: [1_000_000, 100_000][usize::from(index)],
            reference_price: reference,
            lower: reference * 99 / 100,
            upper: reference * 101 / 100,
            observation_sequence: 1,
            terms_epoch: 1,
            ..Market::default()
        }
    })
}
fn book_environment(
    markets: &[Market; 2],
    selected: usize,
) -> crate::engine::book::Environment<'_> {
    crate::engine::book::Environment {
        markets: [Some(&markets[0]), Some(&markets[1])],
        selected,
        funding: [0; 2],
        slot: 100,
        credible: [true; 2],
    }
}
fn order_terms(market: usize) -> crate::instructions::OrderTerms {
    crate::instructions::OrderTerms {
        side: 0,
        lots: 10,
        limit: [61_000, 31_000][market],
        fee_budget: 200,
        start_slot: 100,
        expiry_slot: 200,
        trigger: 0,
        threshold: 0,
        reduce_only: false,
        generation: 0,
    }
}

#[test]
fn whole_book_sums_both_market_reserves_and_rejects_missing_or_wrong_market() {
    use crate::engine::book;
    let markets = book_markets();
    let btc = book_environment(&markets, 0);
    let eth = book_environment(&markets, 1);
    let root = MarginAccount {
        cash: 120_300,
        ..margin_root()
    };
    let first = book::place_with_environment(&root, &btc, 1, order_terms(0), 0).unwrap();
    assert_eq!(first.reserved, 76_800); // 10*(61,000-59,400+6,060)+200.
    let both = book::place_with_environment(&first, &eth, 2, order_terms(1), 0).unwrap();
    assert_eq!(both.reserved, 120_300); // Plus 10*(31,000-29,700+3,030)+200.
    assert!(model(&both).unwrap().withdraw(1, eth.risks()).is_err());
    assert!(book::place(&root, &markets[0], 0, 100, 1, order_terms(0)).is_err());
    assert!(book::replace_with_environment(&both, &eth, 1, 1, order_terms(0), 0).is_err());
    assert!(book::cancel_with_environment(&both, &eth, 1, 1, false).is_err());
    let mut wider = book_markets();
    wider[1].lower = 28_000;
    wider[1].upper = 32_000;
    wider[1].observation_sequence = 2;
    let mut refreshed = both;
    book::refresh_with_environment(&mut refreshed, &book_environment(&wider, 0)).unwrap();
    assert_eq!(refreshed.reserved, 139_000);
    assert_eq!(refreshed.book.reserve_observations, [1, 2]);
}

#[test]
fn btc_order_admission_accrues_eth_funding_before_health() {
    use crate::engine::book;
    let markets = book_markets();
    let mut environment = book_environment(&markets, 0);
    environment.funding[1] = 1_000 * math::SCALE;
    let mut root = MarginAccount {
        cash: 16_519,
        ..margin_root()
    };
    root.positions[1] = Position {
        lots: 2,
        virtual_scaled: -60_000 * math::SCALE,
        generation: 1,
        ..Position::default()
    };
    let terms = crate::instructions::OrderTerms {
        lots: 1,
        ..order_terms(0)
    };
    assert!(book::place_with_environment(&root, &environment, 1, terms, 0).is_err());
    root.cash = 16_520;
    let admitted = book::place_with_environment(&root, &environment, 1, terms, 0).unwrap();
    assert_eq!(admitted.positions[1].virtual_scaled, -62_000 * math::SCALE);
    assert_eq!(
        admitted.positions[1].funding_checkpoint_scaled,
        1_000 * math::SCALE
    );
    assert_eq!(admitted.reserved, 7_860);
    assert_eq!(
        model(&admitted)
            .unwrap()
            .risk_equity(environment.risks())
            .unwrap(),
        13_920 * math::SCALE
    );
}

#[test]
fn delegated_orders_expire_without_revoking_owner_orders_and_replacement_rebinds_authority() {
    use crate::engine::book;
    let markets = book_markets();
    let btc = book_environment(&markets, 0);
    let eth = book_environment(&markets, 1);
    let root = MarginAccount {
        cash: 1_000_000,
        delegate: Pubkey::new_unique(),
        delegate_expiry_slot: 110,
        delegate_epoch: 2,
        ..margin_root()
    };
    let owner_order = book::place_with_environment(&root, &btc, 1, order_terms(0), 0).unwrap();
    let delegated = book::place_with_environment(&owner_order, &eth, 2, order_terms(1), 2).unwrap();
    assert_eq!(delegated.book.orders[1].delegate_epoch, 2);
    let mut expired = delegated.clone();
    let mut environment = book_environment(&markets, 0);
    environment.slot = 110;
    book::refresh_with_environment(&mut expired, &environment).unwrap();
    assert!(expired.book.orders[0].order.active());
    assert!(!expired.book.orders[1].order.active());
    assert_eq!(expired.reserved, 76_800);
    let mut revoked = delegated.clone();
    revoked.delegate_epoch = 3;
    book::refresh_with_environment(&mut revoked, &btc).unwrap();
    assert!(revoked.book.orders[0].order.active());
    assert!(!revoked.book.orders[1].order.active());
    let changed =
        book::replace_with_environment(&owner_order, &btc, 1, 1, order_terms(0), 2).unwrap();
    assert_eq!(changed.book.orders[0].delegate_epoch, 2);
    assert_eq!(changed.book.orders[0].order.version, 2);
    assert!(book::replace_with_environment(&changed, &btc, 1, 1, order_terms(0), 0).is_err());
    let owner_again =
        book::replace_with_environment(&changed, &btc, 1, 2, order_terms(0), 0).unwrap();
    assert_eq!(owner_again.book.orders[0].delegate_epoch, 0);
}

#[test]
fn two_market_protections_share_only_their_own_generation_and_allowance() {
    use crate::engine::book;
    let markets = book_markets();
    let btc = book_environment(&markets, 0);
    let eth = book_environment(&markets, 1);
    let mut root = MarginAccount {
        cash: 1_000_000,
        ..margin_root()
    };
    root.positions[0] = Position {
        lots: 10,
        virtual_scaled: -600_000 * math::SCALE,
        generation: 7,
        ..Position::default()
    };
    root.positions[1] = Position {
        lots: 10,
        virtual_scaled: -300_000 * math::SCALE,
        generation: 9,
        ..Position::default()
    };
    let protection = |market: usize, trigger| crate::instructions::OrderTerms {
        side: 1,
        limit: [59_000, 29_000][market],
        reduce_only: true,
        generation: [7, 9][market],
        trigger,
        threshold: if trigger == 1 {
            [61_000, 31_000][market]
        } else {
            [59_000, 29_000][market]
        },
        ..order_terms(market)
    };
    let first =
        book::protect_with_environment(&root, &btc, 1, protection(0, 1), protection(0, 2), 0)
            .unwrap();
    let mut both =
        book::protect_with_environment(&first, &eth, 3, protection(1, 1), protection(1, 2), 0)
            .unwrap();
    assert_eq!(both.reserved, 58_800);
    assert!(book::place_with_environment(&both, &btc, 5, order_terms(0), 0).is_err());
    // Apply the actual shared paired-fill candidate before consuming its durable
    // protection prefix, as the execution handler does.
    let maker = math::margin::Margin {
        id: 1,
        mode: math::margin::Mode::Isolated(0),
        cash: 1_000_000,
        positions: [math::margin::Position::default(); 2],
        reserved: 0,
    };
    let (filled, _, fee) = math::margin::route_candidate(
        model(&both).unwrap(),
        &[maker],
        0,
        &[(4, 248_000)],
        1,
        [0; 2],
        0,
    )
    .unwrap();
    commit_model(&mut both, filled).unwrap();
    book::consume(&mut both, 0, 4, 248_000, fee).unwrap();
    book::refresh_with_environment(&mut both, &btc).unwrap();
    assert_eq!(both.book.protections[0].protection.remaining, 6);
    assert_eq!(both.book.protections[1].protection.remaining, 10);
    assert_eq!(
        book::eligible(&both, &both.book.orders[1].order).unwrap(),
        6
    );
    assert_eq!(
        book::eligible(&both, &both.book.orders[3].order).unwrap(),
        10
    );
    both.positions[1].generation += 1;
    book::refresh_with_environment(&mut both, &eth).unwrap();
    assert!(both.book.orders[0].order.active() && both.book.orders[1].order.active());
    assert!(!both.book.orders[2].order.active() && !both.book.orders[3].order.active());
    assert_eq!(both.positions[0].generation, 7);
}

//! Literal independent expectations exercise the clearing candidates used by handlers.
use super::*;
use crate::engine::routes::ExecutionQuote;
use crate::{
    instructions::{RouteIntent, RouteLeg},
    state::OracleState,
};

fn clock() -> Clock {
    Clock {
        slot: 100,
        unix_timestamp: 1_006,
        ..Clock::default()
    }
}
fn root() -> MarginAccount {
    MarginAccount {
        schema_version: SCHEMA_VERSION,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        owner: Pubkey::new_from_array([1; 32]),
        delegate_epoch: 1,
        cash: 100_000,
        ..Default::default()
    }
}
fn markets() -> [Market; 2] {
    [0u8, 1].map(|index| {
        let price = [60_000, 30_000][usize::from(index)];
        Market {
            schema_version: SCHEMA_VERSION,
            index,
            lots_per_unit: [1_000_000, 100_000][usize::from(index)],
            terms_epoch: 1,
            config_epoch: 1,
            observation_sequence: 1,
            reference_price: price,
            lower: price * 99 / 100,
            upper: price * 101 / 100,
            valid_from: 90,
            valid_until: 200,
            oracle: OracleState {
                sampled_at: 1_006,
                source_deadline: 1_020,
                status: 2,
                held_epoch: 1,
                last_qualified: 1_006,
                held_until: 1_012,
                held_slot: 200,
                ..Default::default()
            },
            ..Default::default()
        }
    })
}
fn environment(markets: &[Market; 2]) -> book::Environment<'_> {
    book::Environment {
        markets: markets.each_ref().map(Some),
        selected: 0,
        funding: [0, 1_000 * math::SCALE],
        slot: 100,
        credible: [true; 2],
    }
}
fn maker() -> MarginAccount {
    MarginAccount {
        id: 1,
        mode: MODE_ISOLATED,
        isolated_market_index: 0,
        subaccount_index: 1,
        role: ROLE_MAKER,
        owner: Pubkey::new_from_array([2; 32]),
        cash: 1_000_000,
        ..root()
    }
}
fn intent() -> RouteIntent {
    RouteIntent {
        domain: [0; 32],
        terms_epoch: 1,
        config_epoch: 1,
        observation_sequence: 1,
        nonce: 0,
        start_slot: 90,
        expiry_slot: 150,
        side: 0,
        lots: 1,
        all_in_limit: 66_000,
        max_fee: 12,
        reduce_only: false,
        generation: None,
        legs: vec![RouteLeg {
            lots: 1,
            quote_epoch: 1,
            authority_epoch: 1,
        }],
    }
}
fn quote() -> ExecutionQuote {
    ExecutionQuote {
        version: 4,
        maker_id: 0,
        side: 0,
        lots: 1,
        gross_quote: 60_000,
        remaining: 100,
        quote_epoch: 1,
        authority_epoch: 1,
        terms_epoch: 1,
        market_config_epoch: 1,
        start_slot: 90,
        expiry_slot: 200,
        consumed_before: 0,
        reference_price: 60_000,
    }
}
fn fill(
    root: &MarginAccount,
    markets: &[Market; 2],
    request: &RouteIntent,
) -> Result<crate::engine::routes::Candidate> {
    routes::candidate_with_environment(
        &Venue::default(),
        root,
        &[maker()],
        &[quote()],
        request,
        None,
        &environment(markets),
        &clock(),
    )
}

#[test]
fn btc_route_materializes_eth_debit_and_keeps_maker_capital_isolated() {
    let mut trader = root();
    trader.positions[1] = Position {
        lots: 2,
        virtual_scaled: -60_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    let markets = markets();
    let result = fill(&trader, &markets, &intent()).unwrap();
    assert_eq!(
        (result.fee, result.gross, result.gross_lots),
        (12, 60_000, 2)
    );
    assert_eq!(result.trader.cash, 99_988);
    assert_eq!(result.trader.positions[0].lots, 1);
    assert_eq!(
        result.trader.positions[0].virtual_scaled,
        -60_000 * math::SCALE
    );
    assert_eq!(
        result.trader.positions[1].virtual_scaled,
        -62_000 * math::SCALE
    );
    assert_eq!(
        result.trader.positions[1].funding_checkpoint_scaled,
        1_000 * math::SCALE
    );
    let account = model(&result.trader).unwrap();
    // C=99,988; BTC adverse loss=600; ETH adverse loss=2,600.
    assert_eq!(
        account.risk_equity(environment(&markets).risks()).unwrap(),
        96_788 * math::SCALE
    );
    assert_eq!(
        account
            .requirement(environment(&markets).risks(), math::IM_BPS)
            .unwrap(),
        12_120
    );
    assert_eq!(result.makers[0].cash, 1_000_000);
    assert_eq!(result.makers[0].positions[0].lots, -1);
    assert_eq!(
        result.makers[0].positions[0].virtual_scaled,
        60_000 * math::SCALE
    );
    assert_eq!(result.makers[0].positions[1].lots, 0);
    assert_eq!(result.makers[0].positions[1].funding_checkpoint_scaled, 0);
    let mut poor = trader.clone();
    poor.cash = 15_331;
    assert!(fill(&poor, &markets, &intent()).is_err());
    poor.cash = 15_332; // 12 fee + 3,200 adverse loss + 12,120 IM.
    assert!(fill(&poor, &markets, &intent()).is_ok());
    let mut stale = intent();
    stale.nonce = 1;
    assert!(fill(&trader, &markets, &stale).is_err());
    let mut fee = intent();
    fee.max_fee = 11;
    assert!(fill(&trader, &markets, &fee).is_err());
    // Every call was a candidate: the original funding and cash never changed.
    assert_eq!(trader.cash, 100_000);
    assert_eq!(trader.positions[1].virtual_scaled, -60_000 * math::SCALE);
}

#[test]
fn relevant_other_market_requires_normal_but_empty_unrelated_slot_does_not() {
    let mut markets = markets();
    markets[1].valid_until = 100;
    assert!(fill(&root(), &markets, &intent()).is_ok());
    let mut trader = root();
    trader.positions[1] = Position {
        lots: 1,
        virtual_scaled: -30_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    assert!(fill(&trader, &markets, &intent()).is_err());
    markets[1].valid_until = 200;
    markets[1].oracle.status = 1;
    assert!(fill(&trader, &markets, &intent()).is_err());
    assert!(environment(&markets)
        .admit_sources(&trader, &clock(), false)
        .is_ok());
    markets[1].oracle.status = 2;
    assert!(fill(&trader, &markets, &intent()).is_ok());
    let missing = book::Environment::isolated(&markets[0], 0, 100, true).unwrap();
    assert!(routes::candidate_with_environment(
        &Venue::default(),
        &trader,
        &[maker()],
        &[quote()],
        &intent(),
        None,
        &missing,
        &clock()
    )
    .is_err());
}

#[test]
fn materialized_both_market_prefix_survives_expired_hold_without_reverse_funding() {
    let mut markets = markets();
    markets[1].oracle.premium_scaled = math::SCALE;
    let later = Clock {
        unix_timestamp: 1_008,
        ..clock()
    };
    let pending = oracle::effective(2, &markets[1], &later).unwrap();
    assert_eq!(pending, 555_555); // trunc(1e9 scaled premium * 2 seconds / 3,600).
    let mut trader = root();
    trader.positions[1] = Position {
        lots: 3,
        virtual_scaled: -90_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    let accrued = model(&trader).unwrap().accrued([0, pending]).unwrap();
    oracle::materialize(2, &mut markets[1], &later).unwrap();
    let expired = Clock {
        slot: 201,
        unix_timestamp: 1_030,
        ..clock()
    };
    let endpoint = oracle::effective(2, &markets[1], &expired).unwrap();
    assert_eq!(endpoint, pending);
    assert_eq!(
        accrued.accrued([0, endpoint]).unwrap().positions,
        accrued.positions
    );
    assert_eq!(markets[0].funding_index_scaled, 0);
}

#[test]
fn cumulative_cross_fill_fee_is_one_one_two_for_three_two_thousand_atom_fills() {
    // Kernel fee golden, independent of the local oracle's 10,000 minimum price.
    let mut trader = model(&root()).unwrap();
    let mut provider = model(&maker()).unwrap();
    let mut notional = 0;
    for cumulative_fee in [1, 1, 2] {
        let (next, providers, fee) = math::margin::route_candidate(
            trader,
            &[provider],
            0,
            &[(1, 2_000)],
            0,
            [0; 2],
            notional,
        )
        .unwrap();
        notional += 2_000;
        assert_eq!(next.cash, 100_000 - cumulative_fee);
        assert_eq!(providers[0].cash, 1_000_000);
        assert_eq!(trader.cash - next.cash, fee);
        trader = next;
        provider = providers[0];
    }
    assert_eq!(trader.positions[0].lots, 3);
    assert_eq!(trader.positions[0].virtual_scaled, -6_000 * math::SCALE);
    assert_eq!(provider.positions[0].virtual_scaled, 6_000 * math::SCALE);
}

#[test]
fn triggered_cross_protection_uses_real_route_and_consumes_only_its_market_allowance() {
    use crate::instructions::{OrderExecution, OrderTerms};
    let mut markets = markets();
    markets[0].gross_lots = 10;
    let mut trader = root();
    trader.cash = 1_000_000;
    trader.positions[0] = Position {
        lots: 10,
        virtual_scaled: -600_000 * math::SCALE,
        generation: 7,
        ..Default::default()
    };
    trader.positions[1] = Position {
        lots: 10,
        virtual_scaled: -300_000 * math::SCALE,
        generation: 9,
        ..Default::default()
    };
    let mut environment = environment(&markets);
    environment.funding = [0; 2];
    for (index, generation, threshold) in [(0, 7, 61_000), (1, 9, 31_000)] {
        environment.selected = index;
        let terms = OrderTerms {
            side: 1,
            lots: 10,
            limit: threshold - 1_000,
            fee_budget: 1_000,
            start_slot: 90,
            expiry_slot: 180,
            trigger: 1,
            threshold,
            reduce_only: true,
            generation,
        };
        trader = book::protect_with_environment(
            &trader,
            &environment,
            1 + 2 * index as u64,
            terms.clone(),
            OrderTerms {
                trigger: 2,
                threshold: threshold - 2_000,
                ..terms
            },
            0,
        )
        .unwrap();
    }
    let execution = || OrderExecution {
        id: 1,
        version: 1,
        filled: 0,
        observation_sequence: 1,
        start_slot: 90,
        expiry_slot: 150,
        lots: 4,
        legs: vec![RouteLeg {
            lots: 4,
            quote_epoch: 1,
            authority_epoch: 1,
        }],
    };
    let group = Venue::default();
    assert!(routes::stored_intent(&group, &markets[0], &trader, execution(), &clock()).is_err());
    markets[0].reference_price = 62_000;
    markets[0].lower = 61_380;
    markets[0].upper = 62_620;
    let (request, index) =
        routes::stored_intent(&group, &markets[0], &trader, execution(), &clock()).unwrap();
    let mut environment = book::Environment {
        markets: markets.each_ref().map(Some),
        selected: 0,
        funding: [0; 2],
        slot: 100,
        credible: [true; 2],
    };
    let quotes = [ExecutionQuote {
        side: 1,
        lots: 4,
        gross_quote: 248_000,
        reference_price: 62_000,
        ..quote()
    }];
    let result = routes::candidate_with_environment(
        &group,
        &trader,
        &[maker()],
        &quotes,
        &request,
        Some(index),
        &environment,
        &clock(),
    )
    .unwrap();
    assert_eq!(result.fee, 50);
    assert_eq!(result.trader.cash, 999_950);
    assert_eq!(result.trader.positions[0].lots, 6);
    assert_eq!(
        result.trader.positions[0].virtual_scaled,
        -352_000 * math::SCALE
    );
    assert_eq!(result.trader.book.protections[0].protection.remaining, 6);
    assert_eq!(result.trader.book.protections[1].protection.remaining, 10);
    assert_eq!(
        book::eligible(&result.trader, &result.trader.book.orders[1].order).unwrap(),
        6
    );
    let mut changed = *result.trader;
    changed.positions[1].generation += 1;
    environment.selected = 1;
    book::refresh_with_environment(&mut changed, &environment).unwrap();
    assert!(changed.book.orders[0].order.active() && changed.book.orders[1].order.active());
    assert!(!changed.book.orders[2].order.active() && !changed.book.orders[3].order.active());
}

#[test]
fn relevant_market_set_refuses_hidden_fractional_claims_and_preserves_empty_slot() {
    let markets = markets();
    let mut environment = environment(&markets);
    environment.markets[1] = None;
    environment.funding[1] = 0;
    let mut trader = root();
    trader.positions[1].funding_checkpoint_scaled = -77;
    trader.positions[1].generation = 9;
    trader.book.reserve_observations[1] = 41;
    let venue = Venue::default();
    let execute = |trader: &MarginAccount| routes::candidate_with_environment(
        &venue, trader, &[maker()], &[quote()], &intent(), None, &environment, &clock());
    let result = execute(&trader).unwrap();
    // One BTC lot at 60,000; 2 bps = 12 atoms. No positive unpaid credit.
    assert_eq!(result.trader.cash, 99_988);
    assert_eq!(result.trader.positions[0].lots, 1);
    assert_eq!(result.trader.positions[0].virtual_scaled, -60_000 * math::SCALE);
    assert_eq!(result.trader.positions[1].funding_checkpoint_scaled, -77);
    assert_eq!(result.trader.positions[1].generation, 9);
    assert_eq!(result.trader.book.reserve_observations[1], 41);
    for claim in [-1, 1, -30_000 * math::SCALE, 30_000 * math::SCALE] {
        trader.positions[1].virtual_scaled = claim;
        assert!(execute(&trader).is_err(), "even a one-scaled-unit claim is relevant");
    }
    trader.positions[1].virtual_scaled = 0;
    trader.positions[1].lots = 1;
    assert!(execute(&trader).is_err());
}

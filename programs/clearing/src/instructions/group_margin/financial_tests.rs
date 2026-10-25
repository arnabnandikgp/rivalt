//! Literal independent expectations exercise the clearing candidates used by handlers.
use super::*;
use crate::{
    instructions::{
        group_trading::{book, oracle, routes},
        RouteIntent, RouteLeg,
    },
    state::OracleState,
};
use maker_interface::QuoteResponse;

fn clock() -> Clock {
    Clock {
        slot: 100,
        unix_timestamp: 1_006,
        ..Clock::default()
    }
}
fn root() -> MarginAccountV2 {
    MarginAccountV2 {
        schema_version: 2,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        owner: Pubkey::new_from_array([1; 32]),
        delegate_epoch: 1,
        cash: 100_000,
        ..Default::default()
    }
}
fn markets() -> [GroupMarketV2; 2] {
    [0u8, 1].map(|index| {
        let price = [60_000, 30_000][usize::from(index)];
        GroupMarketV2 {
            schema_version: 2,
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
fn environment(markets: &[GroupMarketV2; 2]) -> book::Environment<'_> {
    book::Environment {
        markets: markets.each_ref().map(Some),
        selected: 0,
        funding: [0, 1_000 * math::SCALE],
        slot: 100,
        credible: [true; 2],
    }
}
fn maker() -> MarginAccountV2 {
    MarginAccountV2 {
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
fn quote() -> QuoteResponse {
    QuoteResponse {
        version: 2,
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
    root: &MarginAccountV2,
    markets: &[GroupMarketV2; 2],
    request: &RouteIntent,
) -> Result<routes::Candidate> {
    routes::candidate_with_environment(
        &ClearingGroupV2::default(),
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
    trader.positions[1] = PositionV2 {
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
    trader.positions[1] = PositionV2 {
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
        &ClearingGroupV2::default(),
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
fn flat_netting_is_owner_and_group_bound_and_preserves_exact_fraction() {
    let mut account = root();
    account.positions[0].virtual_scaled = 300 * math::SCALE;
    account.positions[1].virtual_scaled = -200 * math::SCALE;
    let result = netting::candidate(&account, account.owner, account.group, [5, 7]).unwrap();
    assert_eq!(
        result.positions.map(|position| position.virtual_scaled),
        [100 * math::SCALE, 0]
    );
    assert_eq!(result.cash, account.cash);
    assert_eq!(
        result
            .positions
            .map(|position| position.funding_checkpoint_scaled),
        [5, 7]
    );
    assert!(netting::candidate(&account, Pubkey::new_unique(), account.group, [0; 2]).is_err());
    assert!(netting::candidate(&account, account.owner, Pubkey::new_unique(), [0; 2]).is_err());
    for market in 0..2 {
        let mut open = account.clone();
        open.positions[market].lots = 1;
        open.positions[market].generation = 1;
        assert!(netting::candidate(&open, open.owner, open.group, [0; 2]).is_err());
    }
    let mut active = account.clone();
    active.book.last_order_id = 1;
    active.book.orders[0].order = crate::state::StoredOrder {
        id: 1,
        version: 1,
        lots: 1,
        state: crate::constants::orders::OPEN,
        ..Default::default()
    };
    assert!(netting::candidate(&active, active.owner, active.group, [0; 2]).is_err());
    account.positions[0].virtual_scaled = 3 * math::SCALE + 1;
    account.positions[1].virtual_scaled = -(2 * math::SCALE + 2);
    // Historical protection without active children grants no authority.
    account.book.protections[0].protection.remaining = 10;
    let fraction = netting::candidate(&account, account.owner, account.group, [0; 2]).unwrap();
    assert_eq!(
        fraction.positions.map(|position| position.virtual_scaled),
        [math::SCALE - 1, 0]
    );
    assert!(netting::candidate(&fraction, fraction.owner, fraction.group, [0; 2]).is_err());
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
    assert!(pending > 0);
    let mut trader = root();
    trader.positions[1] = PositionV2 {
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

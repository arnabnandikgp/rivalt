//! Independently calculated atom-level expectations against the actual adapters,
//! route candidate and fee transition. No expected result calls the engine twice.
use super::super::{RouteIntent, RouteLeg};
use super::*;
use crate::engine::routes as candidates;

fn clock() -> Clock {
    Clock {
        slot: 100,
        unix_timestamp: 1_006,
        ..Default::default()
    }
}
fn root() -> MarginAccount {
    MarginAccount {
        schema_version: 5,
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
            schema_version: 5,
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
        observation_sequence: 7,
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
fn quote() -> crate::engine::routes::ExecutionQuote {
    crate::engine::routes::ExecutionQuote {
        version: 3,
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
    trader: &MarginAccount,
    markets: &[Market; 2],
    request: &RouteIntent,
) -> Result<candidates::Candidate> {
    let views = [market_view(&markets[0])?, market_view(&markets[1])?];
    candidates::candidate_for_version(
        &Venue::default(),
        &*root_view(trader)?,
        &[*root_view(&maker())?],
        &[quote()],
        request,
        None,
        &environment(&views, 0, &clock())?,
        &clock(),
        3,
    )
}

#[test]
fn whole_account_funding_fee_and_health_have_literal_boundaries() {
    let mut trader = root();
    trader.positions[1] = crate::state::Position {
        lots: 2,
        virtual_scaled: -60_000 * math::SCALE,
        generation: 1,
        ..Default::default()
    };
    let mut markets = markets();
    markets[1].funding_index_scaled = 1_000 * math::SCALE;
    markets[1].oracle.funding_base = 1_000 * math::SCALE;
    let result = fill(&trader, &markets, &intent()).unwrap();
    assert_eq!(
        (result.fee, result.gross, result.gross_lots),
        (12, 60_000, 2)
    );
    assert_eq!(result.trader.cash, 99_988);
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
    assert_eq!(result.makers[0].cash, 1_000_000);
    assert_eq!(result.makers[0].positions[0].lots, -1);
    assert_eq!(result.makers[0].positions[1].virtual_scaled, 0);
    // 12 fee + 600 BTC loss + 2,600 ETH loss + 12,120 account IM = 15,332.
    trader.cash = 15_331;
    assert!(fill(&trader, &markets, &intent()).is_err());
    trader.cash = 15_332;
    assert!(fill(&trader, &markets, &intent()).is_ok());
    let mut fee = intent();
    fee.max_fee = 11;
    assert!(fill(&trader, &markets, &fee).is_err());
    let mut wrong_version = quote();
    wrong_version.version = 2;
    let views = [
        market_view(&markets[0]).unwrap(),
        market_view(&markets[1]).unwrap(),
    ];
    assert!(candidates::candidate_for_version(
        &Venue::default(),
        &root_view(&trader).unwrap(),
        &[*root_view(&maker()).unwrap()],
        &[wrong_version],
        &intent(),
        None,
        &environment(&views, 0, &clock()).unwrap(),
        &clock(),
        3
    )
    .is_err());
}

#[test]
fn positive_unpaid_claims_never_fund_risk_or_fee() {
    let mut trader = root();
    trader.cash = 6_671;
    trader.positions[1].virtual_scaled = 1_000_000 * math::SCALE;
    // BTC 12 fee + 600 adverse loss + 6,060 IM, with no ETH positive credit.
    assert!(fill(&trader, &markets(), &intent()).is_err());
    trader.cash = 6_672;
    assert!(fill(&trader, &markets(), &intent()).is_ok());
}

#[test]
fn fee_carry_is_exact_per_market_and_never_an_asset() {
    let mut custody = Custody {
        schema_version: 5,
        total_cash: 100_000,
        ..Default::default()
    };
    let mut ledgers = [0u8, 1].map(|market_index| MarketLedger {
        schema_version: 5,
        market_index,
        ..Default::default()
    });
    let mut paid = [0u64; 2];
    for index in 0..97usize {
        let market = index % 2;
        let fee = (index as u64 * 17) % 19;
        let before = paid[market];
        paid[market] += fee;
        let (insurance, retained, carry) =
            split_fee(&mut custody, &mut ledgers[market], fee).unwrap();
        assert_eq!(insurance, paid[market] / 4 - before / 4);
        assert_eq!(retained, fee - insurance);
        assert_eq!(u64::from(carry), before % 4);
        assert_eq!(ledgers[market].insurance, paid[market] / 4);
        assert_eq!(ledgers[market].fees, paid[market] - paid[market] / 4);
        assert_eq!(
            u64::from(ledgers[market].insurance_fee_remainder),
            paid[market] % 4
        );
        assert_eq!(
            custody.total_cash
                + ledgers
                    .iter()
                    .map(|ledger| ledger.insurance + ledger.fees)
                    .sum::<u64>(),
            100_000
        );
    }
    // Consuming a reserve or adding a seed never resets its fee-count remainder.
    let carry = ledgers[0].insurance_fee_remainder;
    ledgers[0].insurance = 7;
    let result = split_fee(&mut custody, &mut ledgers[0], 1).unwrap();
    assert_eq!(result.0, u64::from(carry + 1) / 4);
    assert_eq!(ledgers[0].insurance, 7 + result.0);
}

#[test]
fn source_relevance_and_account_guard_ignore_unrelated_history() {
    let trader = root();
    let mut sources = markets();
    sources[1].valid_until = 0;
    assert!(fill(&trader, &sources, &intent()).is_ok());
    let mut exposed = trader.clone();
    exposed.positions[1].lots = 1;
    exposed.positions[1].virtual_scaled = -30_000 * math::SCALE;
    assert!(fill(&exposed, &sources, &intent()).is_err());
    let venue = Venue {
        terms_epoch: 4,
        ..Default::default()
    };
    let mut safety = VenueSafety {
        epoch: 9,
        ..Default::default()
    };
    let guard = authority::AccountGuard {
        safety_epoch: 9,
        venue_terms_epoch: 4,
        nonce: 0,
        state_version: 0,
    };
    assert!(guard.check(&venue, &safety, &trader).is_ok());
    safety.epoch += 1;
    assert!(guard.check(&venue, &safety, &trader).is_err());
    let mut mutated = trader;
    mutated.state_version += 1;
    safety.epoch -= 1;
    assert!(guard.check(&venue, &safety, &mutated).is_err());
}

#[test]
fn dependency_stamps_follow_both_claims_but_not_cash_only_siblings() {
    let mut custody = Custody::default();
    let mut account = root();
    invalidate(&mut custody, account.positions, account.positions).unwrap();
    assert_eq!(custody.liability_versions, [0, 0]);
    account.positions[0].virtual_scaled = 1;
    account.positions[1].virtual_scaled = -1;
    invalidate(&mut custody, account.positions, account.positions).unwrap();
    assert_eq!(custody.liability_versions, [1, 1]);
    let before = account.positions;
    account.positions[0].virtual_scaled = 0;
    invalidate(&mut custody, before, account.positions).unwrap();
    assert_eq!(custody.liability_versions, [2, 2]);
}

#[test]
fn typed_adapter_rejects_identity_mutation_and_wrong_schema() {
    let mut account = root();
    let mut view = root_view(&account).unwrap();
    view.owner = Pubkey::new_unique();
    assert!(commit_root(&mut account, &view).is_err());
    assert_eq!(account.owner, root().owner);
    account.schema_version = 2;
    assert!(root_view(&account).is_err());
    let mut market = markets()[0].clone();
    market.cross_eligible = false;
    assert!(market_view(&market).is_err());
}

#[test]
fn consumed_funding_survives_hold_expiry_and_negative_new_premium() {
    let mut markets = markets();
    // Endpoint is premium * seconds / 3,600. Two elapsed seconds give +/- 0.02 atoms/lot.
    for (index, market) in markets.iter_mut().enumerate() {
        market.oracle.sampled_at = 1_004;
        market.oracle.held_until = 1_010;
        market.oracle.premium_scaled = if index == 0 {
            36 * math::SCALE
        } else {
            -36 * math::SCALE
        };
    }
    let [btc, eth] = &mut markets;
    materialize([btc, eth], &clock()).unwrap();
    assert_eq!(markets[0].funding_index_scaled, math::SCALE / 50);
    assert_eq!(markets[1].funding_index_scaled, -(math::SCALE / 50));
    let mut expired = clock();
    expired.slot = 201;
    expired.unix_timestamp = 1_021;
    assert_eq!(
        oracle::effective(ACTIVE, &markets[0], &expired).unwrap(),
        math::SCALE / 50
    );
    assert_eq!(
        oracle::effective(ACTIVE, &markets[1], &expired).unwrap(),
        -(math::SCALE / 50)
    );
}

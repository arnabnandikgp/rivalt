use super::*;
use crate::instructions::account_cash::tests::fixture_snapshot;
use crate::state::{OracleState, Position as StoredPosition};
use clearing_accounting::market_slots::storage::MAGIC;
use financial_core::{margin::Risk, route, SCALE};

// With BTC long 1 at 115 marked at 100 and ETH short 1 at 80 marked at
// 100, the prefix alone needs 20 IM + 15 BTC debt + 20 ETH debt = 55.
fn root(cash: u64, maker: bool) -> MarginAccount {
    let mut root = MarginAccount {
        schema_version: SCHEMA_VERSION,
        lifecycle: MEMBER_FINANCIAL,
        activation_generation: 1,
        owner: Address::new_from_array([3; 32]),
        delegate_epoch: 1,
        mode: if maker { MODE_ISOLATED } else { MODE_CROSS },
        isolated_market_index: if maker {
            LISTED_CAPITAL_TAG
        } else {
            CROSS_MARKET_SENTINEL
        },
        role: if maker { ROLE_MAKER } else { ROLE_TRADER },
        id: if maker { 2 } else { 1 },
        subaccount_index: u32::from(maker),
        cash,
        ..Default::default()
    };
    if !maker {
        root.positions = [(1, -115), (-1, 80)].map(|(lots, cost)| StoredPosition {
            lots,
            virtual_scaled: cost * SCALE,
            generation: 1,
            ..Default::default()
        });
    }
    root
}
fn empty(root: &MarginAccount) -> Vec<u8> {
    let mut bytes =
        vec![0; initial_margin_size(root.mode, root.isolated_market_index) - MARGIN_ALLOCATION];
    bytes[..MAGIC.len()].copy_from_slice(MAGIC);
    bytes
}
fn sample(market: u16) -> MarketWindow {
    MarketWindow {
        market,
        current: Risk {
            lower: 150,
            upper: 150,
            funding: 0,
        },
        funding_low: 0,
        funding_high: 0,
    }
}

#[test]
fn fee_and_margin_use_the_cash_on_the_same_root_as_btc_and_eth() {
    let snapshot = fixture_snapshot();
    let id = u16::MAX;
    for (cash, should_fill) in [(225, false), (226, true)] {
        // Added SOL long 10 at 152: 150 IM + 20 debt + 1 aggregate fee.
        let initial = root(cash, false);
        let capital = root(150, true);
        let mut buyer =
            ListedMargin::prepare(&initial, &empty(&initial), None, &snapshot, true).unwrap();
        let mut seller =
            ListedMargin::prepare(&capital, &empty(&capital), Some(id), &snapshot, true)
                .unwrap();
        let (trader, makers, fee) = route::candidate(
            buyer.participant(id).unwrap(),
            &[seller.participant(id).unwrap()],
            &[(10, 1520)],
            0,
            0,
            0,
        )
        .unwrap();
        assert_eq!(fee, 1);
        assert_eq!(
            buyer
                .admit_fill(&snapshot, id, trader, 1520, &[sample(id)])
                .is_ok(),
            should_fill
        );
        assert_eq!(buyer.directory.records().len(), usize::from(should_fill));
        assert_eq!(buyer.root.cash, cash - u64::from(should_fill));
        seller
            .admit_fill(&snapshot, id, makers[0], 1520, &[sample(id)])
            .unwrap();
        assert_eq!(seller.root.cash, 150);
        assert_eq!(
            seller.directory.records()[0].1.position.virtual_scaled,
            1520 * SCALE
        );
        if should_fill {
            let mut bytes = empty(&initial);
            buyer.directory.write_listed_bytes(&mut bytes).unwrap();
            let restored =
                ListedMargin::prepare(&buyer.root, &bytes, None, &snapshot, true).unwrap();
            assert_eq!(restored.participant(id).unwrap().lots, 10);
            assert_eq!(restored.root.positions[0].lots, 1);
            assert_eq!(restored.root.positions[1].lots, -1);
        }
    }
}

#[test]
fn other_listed_positions_must_accrue_and_flat_debt_still_uses_cash() {
    let snapshot = fixture_snapshot();
    let initial = root(355, false);
    let mut buyer =
        ListedMargin::prepare(&initial, &empty(&initial), None, &snapshot, true).unwrap();
    let image = |market, lots, cost| MarketImage {
        market,
        position: Position {
            lots,
            virtual_scaled: cost * SCALE,
            funding_checkpoint: 0,
            generation: 1,
        },
        entry: if lots == 0 {
            Default::default()
        } else {
            clearing_accounting::entry_cost::EntryCost::default()
                .fill(0, lots, 1500)
                .unwrap()
        },
    };
    buyer.directory = buyer
        .directory
        .successor(&[image(2, 10, -1500), image(3, 0, -3)], &[])
        .unwrap();
    let mut filled = buyer
        .participant(4)
        .unwrap()
        .quoted_fill(0, 10, 1500, 0)
        .unwrap();
    filled.cash -= 1;
    // 55 prefix + 150 existing IM + 10 existing funding debt + 3 flat debt
    // + 150 new IM + 1 fee = 369. An incomplete source list must also refuse.
    let funding = || MarketWindow {
        market: 2,
        current: Risk {
            funding: SCALE,
            ..sample(2).current
        },
        funding_low: SCALE,
        funding_high: SCALE,
    };
    assert!(buyer
        .admit_fill(&snapshot, 4, filled, 1500, &[sample(4)])
        .is_err());
    assert!(buyer
        .admit_fill(&snapshot, 4, filled, 1500, &[funding(), sample(4)])
        .is_err());
    assert_eq!(
        buyer.directory.records()[0].1.position.funding_checkpoint,
        0
    );
    buyer.root.cash = 369;
    filled.cash = 368;
    buyer
        .admit_fill(&snapshot, 4, filled, 1500, &[funding(), sample(4)])
        .unwrap();
    assert_eq!(
        buyer.directory.records()[0].1.position.virtual_scaled,
        -1510 * SCALE
    );
}

#[test]
fn opening_on_a_listing_requires_healthy_sources_in_existing_markets() {
    let initial = root(1_000_000, false);
    let mut snapshot = fixture_snapshot();
    snapshot.markets[1].as_mut().unwrap().oracle = OracleState {
        status: 1,
        ..snapshot.markets[1].as_ref().unwrap().oracle
    };
    assert!(ListedMargin::prepare(&initial, &empty(&initial), None, &snapshot, true).is_err());
}

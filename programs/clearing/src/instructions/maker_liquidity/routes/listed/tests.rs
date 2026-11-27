use super::*;
use crate::instructions::account_cash::tests::fixture_snapshot;
use clearing_accounting::{market_slots::MarketSlots, Mode};
use financial_core::{margin::Risk, SCALE};

fn account(id: u64, cash: u64, market: Option<u16>) -> ListedMargin {
    let maker = market.is_some();
    let mut root = Box::new(MarginAccount {
        id,
        cash,
        schema_version: SCHEMA_VERSION,
        lifecycle: MEMBER_FINANCIAL,
        activation_generation: 1,
        subaccount_index: u32::from(maker),
        mode: if maker { MODE_ISOLATED } else { MODE_CROSS },
        isolated_market_index: if maker {
            LISTED_CAPITAL_TAG
        } else {
            CROSS_MARKET_SENTINEL
        },
        role: if maker { ROLE_MAKER } else { ROLE_TRADER },
        owner: Address::new_from_array([id as u8; 32]),
        delegate_epoch: 1,
        ..Default::default()
    });
    if !maker {
        // Two longs opened at 100, current mark 100, so 20 atoms of existing IM.
        for position in &mut root.positions {
            position.lots = 1;
            position.virtual_scaled = -100 * SCALE;
            position.generation = 1;
        }
    }
    let mode = market.map_or(Mode::Cross, |id| Mode::Isolated(id.into()));
    ListedMargin {
        root,
        directory: MarketSlots::new(mode, if maker { 1 } else { 6 }),
    }
}

#[test]
fn two_funded_makers_share_one_fee_and_only_filled_roots_advance() {
    let snapshot = fixture_snapshot();
    let market = u16::MAX;
    let trader = account(1, 177, None);
    let makers = [
        account(2, 75, Some(market)),
        account(3, 75, Some(market)),
        account(4, 0, Some(market)),
    ];
    let source = MarketWindow {
        market,
        current: Risk {
            lower: 150,
            upper: 150,
            funding: 0,
        },
        funding_low: 0,
        funding_high: 0,
    };
    let mut book = Book {
        trader: &trader,
        makers: &makers,
        base: &snapshot,
        trader_windows: core::slice::from_ref(&source),
        selected: &source,
        gross_lots: 0,
    };
    // Two five-lot legs at aggregate gross 1,506: 150 new IM + 6 debt + 20 old IM + 1 fee.
    let allocation = routing::Allocation {
        lots: [5, 5, 0],
        amounts: [751, 755, 0],
        gross: 1506,
        fee: 1,
        all_in: 1507,
    };
    let selected = book.candidate(0, &allocation).unwrap();
    assert_eq!(selected.gross_lots, 20);
    assert_eq!(
        (
            selected.trader.root.cash,
            selected.trader.root.nonce,
            selected.trader.root.state_version
        ),
        (176, 1, 1)
    );
    assert_eq!(
        selected.trader.participant(market).unwrap().virtual_scaled,
        -1506 * SCALE
    );
    assert_eq!(selected.makers.len(), 2);
    for (index, maker) in selected.makers {
        assert_eq!(
            (maker.root.cash, maker.root.nonce, maker.root.state_version),
            (75, 0, 1)
        );
        assert_eq!(maker.participant(market).unwrap().lots, -5);
        assert_eq!(
            maker.participant(market).unwrap().virtual_scaled,
            i128::from(allocation.amounts[index]) * SCALE
        );
    }
    // A selected underfunded maker or an exhausted gross-lots cap refuses the whole candidate.
    let underfunded = [
        account(2, 74, Some(market)),
        account(3, 75, Some(market)),
        account(4, 0, Some(market)),
    ];
    book.makers = &underfunded;
    assert!(book.candidate(0, &allocation).is_err());
    book.makers = &makers;
    book.gross_lots = financial_core::MAX_GROSS_LOTS - 19;
    assert!(book.candidate(0, &allocation).is_err());
    assert!(trader.directory.records().is_empty());
    assert!(makers
        .iter()
        .all(|maker| maker.directory.records().is_empty()));
}

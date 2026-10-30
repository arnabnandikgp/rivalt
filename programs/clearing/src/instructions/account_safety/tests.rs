//! Literal economic expectations against the V3 adapter used by the handler.
use super::*;
use crate::state::{OracleState, Position};
use financial_core::SCALE;

fn root(id: u16, cash: u64) -> MarginAccount {
    MarginAccount {
        schema_version: 6,
        id,
        cash,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        delegate_epoch: 1,
        owner: Pubkey::new_unique(),
        ..Default::default()
    }
}
fn markets() -> [Market; 2] {
    [0u8, 1].map(|index| Market {
        schema_version: 6,
        index,
        cross_eligible: true,
        terms_epoch: 1,
        config_epoch: 1,
        lots_per_unit: if index == 0 { 1_000_000 } else { 100_000 },
        reference_price: 100,
        lower: 100,
        upper: 100,
        valid_from: 90,
        valid_until: 200,
        gross_lots: 20,
        funding_time: 1000,
        oracle: OracleState {
            sampled_at: 1000,
            source_deadline: 1020,
            status: 2,
            held_epoch: 1,
            held_until: 1006,
            held_slot: 200,
            last_qualified: 1000,
            ..Default::default()
        },
        ..Default::default()
    })
}
fn clock() -> Clock {
    Clock {
        slot: 100,
        unix_timestamp: 1000,
        ..Default::default()
    }
}
fn debtor() -> MarginAccount {
    let mut target = root(0, 185);
    target.positions =
        [(10, -1000 * SCALE), (1, -250 * SCALE)].map(|(lots, virtual_scaled)| Position {
            lots,
            virtual_scaled,
            generation: 1,
            ..Default::default()
        });
    target
}

#[test]
fn liquidation_consumes_other_market_funding_and_improves_after_the_cash_fee() {
    let target = debtor();
    let receiver = root(1, 100);
    let mut markets = markets();
    markets[1].funding_index_scaled = SCALE / 3;
    markets[1].oracle.funding_base = SCALE / 3;
    let result = risk::candidate(
        &target,
        &receiver,
        [&markets[0], &markets[1]],
        0,
        5,
        100,
        &clock(),
    )
    .unwrap();
    // Before: C185 - ETH debt150 1/3, MM55 => deficit20 1/3.
    // After: C184 - ETH debt150 1/3, MM30 => no deficit. Receiver gets 1 atom.
    assert_eq!(result.before, 20 * SCALE + SCALE / 3);
    assert_eq!(result.after, 0);
    assert_eq!(result.fee, 1);
    assert_eq!((result.target.cash, result.receiver.cash), (184, 101));
    assert_eq!(result.target.positions[0].lots, 5);
    assert_eq!(result.receiver.positions[0].lots, 5);
    assert_eq!(
        result.target.positions[1].virtual_scaled,
        -250 * SCALE - SCALE / 3
    );
    assert_eq!(
        result.target.positions[1].funding_checkpoint_scaled,
        SCALE / 3
    );
    assert_eq!(result.gross_lots, 20);
}

#[test]
fn no_progress_receiver_health_maker_capital_and_flip_all_reject() {
    let target = debtor();
    let receiver = root(1, 100);
    let markets = markets();
    let view = [&markets[0], &markets[1]];
    // The 10% price envelope alone is insufficient: loss50 plus fee1 exceeds
    // released MM25, so this reduction makes the whole account worse.
    assert!(risk::candidate(&target, &receiver, view, 0, 5, 90, &clock()).is_err());
    assert!(risk::candidate(&target, &receiver, view, 0, 11, 100, &clock()).is_err());
    let mut poor = root(1, 48);
    poor.positions[1].virtual_scaled = 1_000_000 * SCALE;
    // Positive unpaid profit cannot cover receiver IM50 after receiving fee1.
    assert!(risk::candidate(&target, &poor, view, 0, 5, 100, &clock()).is_err());
    let mut maker = root(1, 100);
    maker.mode = MODE_ISOLATED;
    maker.subaccount_index = 1;
    maker.isolated_market_index = 0;
    maker.role = ROLE_MAKER;
    assert!(risk::candidate(&target, &maker, view, 0, 5, 100, &clock()).is_err());
}

#[test]
fn liquidation_requires_sources_for_other_exposure_and_preserves_generation() {
    let target = debtor();
    let receiver = root(1, 100);
    let mut markets = markets();
    markets[1].valid_until = 99;
    assert!(risk::candidate(
        &target,
        &receiver,
        [&markets[0], &markets[1]],
        0,
        5,
        100,
        &clock()
    )
    .is_err());
    markets[1].valid_until = 200;
    let result = risk::candidate(
        &target,
        &receiver,
        [&markets[0], &markets[1]],
        0,
        10,
        100,
        &clock(),
    )
    .unwrap();
    assert_eq!(result.target.positions[0].lots, 0);
    assert_eq!(result.target.positions[0].generation, 2);
    assert_eq!(result.target.positions[1].generation, 1);
    assert_eq!(result.receiver.positions[0].generation, 1);
}

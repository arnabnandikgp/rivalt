//! Literal economic expectations against the real candidates; no reference calls
//! the implementation to manufacture its own expected output.
use super::*;
use math::SCALE;

fn root(cash: u64, claims: [i128; 2]) -> MarginAccount {
    MarginAccount {
        schema_version: 3,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        owner: Pubkey::new_from_array([1; 32]),
        delegate_epoch: 1,
        cash,
        positions: claims.map(|virtual_scaled| v2::Position {
            virtual_scaled,
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn fixture_snapshot() -> Snapshot {
    let markets = [0u8, 1].map(|index| Market {
        schema_version: 3,
        index,
        cross_eligible: true,
        lots_per_unit: [1_000_000, 100_000][usize::from(index)],
        terms_epoch: 1,
        config_epoch: 1,
        reference_price: 100,
        lower: 100,
        upper: 100,
        valid_from: 90,
        valid_until: 200,
        oracle: crate::state::OracleState {
            sampled_at: 1_000,
            source_deadline: 1_020,
            status: 2,
            held_epoch: 1,
            held_until: 1_006,
            held_slot: 200,
            last_qualified: 1_000,
            ..Default::default()
        },
        ..Default::default()
    });
    Snapshot::new(
        [&markets[0], &markets[1]],
        &Clock {
            slot: 100,
            unix_timestamp: 1_000,
            ..Default::default()
        },
    )
    .unwrap()
}

#[test]
fn flat_exit_needs_own_cash_and_gross_losses_without_fresh_prices() {
    let mut snapshot = fixture_snapshot();
    for market in &mut snapshot.markets {
        market.valid_until = 0;
        market.oracle.status = 0;
    }
    let account = root(100, [-60 * SCALE, 1_000 * SCALE]);
    let next = withdraw_candidate(&account, &snapshot, 40).unwrap();
    assert_eq!(next.cash, 60);
    assert_eq!(next.positions[0].virtual_scaled, -60 * SCALE);
    assert_eq!(next.positions[1].virtual_scaled, 1_000 * SCALE);
    assert_eq!((next.nonce, next.state_version), (1, 1));
    assert!(withdraw_candidate(&account, &snapshot, 41).is_err());
    assert!(withdraw_candidate(&account, &snapshot, 0).is_err());
    let both = root(121, [-60 * SCALE, -60 * SCALE]);
    assert_eq!(withdraw_candidate(&both, &snapshot, 1).unwrap().cash, 120);
    assert!(withdraw_candidate(&both, &snapshot, 2).is_err());
}

#[test]
fn withdrawals_enumerate_independent_flat_fraction_boundaries() {
    let snapshot = fixture_snapshot();
    for cash in 1..=12u64 {
        for first in -9i128..=9 {
            for second in -9i128..=9 {
                for amount in 1..=cash {
                    let claims = [first * SCALE / 3, second * SCALE / 3];
                    // Direct integer inequality, independent from Margin risk/withdraw code.
                    let debt = (-claims[0]).max(0) + (-claims[1]).max(0);
                    let expected = i128::from(cash - amount) * SCALE >= debt;
                    assert_eq!(
                        withdraw_candidate(&root(cash, claims), &snapshot, amount).is_ok(),
                        expected,
                        "cash={cash}, claims={claims:?}, amount={amount}"
                    );
                }
            }
        }
    }
}

#[test]
fn all_mixed_funding_corners_are_checked_not_just_diagonals() {
    let mut account = root(121, [-100 * SCALE, -100 * SCALE]);
    for position in &mut account.positions {
        position.lots = 1;
        position.generation = 1;
    }
    let mut snapshot = fixture_snapshot();
    // Direct helper boundary: broad endpoints isolate the four-corner proof.
    // These are not claimed as observed six-second oracle premiums.
    snapshot.bounds = [[-60 * SCALE, 60 * SCALE]; 2];
    for risk in &mut snapshot.risks {
        risk.funding = -60 * SCALE;
    }
    assert!(withdraw_candidate(&account, &snapshot, 1).is_ok());
    assert!(withdraw_candidate(&account, &snapshot, 2).is_err());
    let model = trading::model(&root(119, [-100 * SCALE, -100 * SCALE])).unwrap();
    let mut exposed = model;
    exposed.positions = trading::model(&account).unwrap().positions;
    for diagonal in [[-60 * SCALE, 60 * SCALE], [60 * SCALE, -60 * SCALE]] {
        let mut risks = snapshot.risks;
        for index in 0..2 {
            risks[index].funding = diagonal[index];
        }
        assert!(exposed.risk_equity(risks).unwrap() >= 0);
    }
    assert!(snapshot.held_solvent(exposed).is_err());
}

#[test]
fn full_current_margin_and_orders_survive_cash_outflow() {
    let mut account = root(100, [-100 * SCALE, 0]);
    account.positions[0].lots = 1;
    account.positions[0].generation = 1;
    let snapshot = fixture_snapshot();
    // 1 lot * 100 index atoms * 10% IM = 10 remaining cash.
    assert_eq!(
        withdraw_candidate(&account, &snapshot, 90).unwrap().cash,
        10
    );
    assert!(withdraw_candidate(&account, &snapshot, 91).is_err());
    let mut stale = fixture_snapshot();
    stale.markets[0].valid_until = 0;
    assert!(withdraw_candidate(&account, &stale, 1).is_err());
    let mut ordered_snapshot = fixture_snapshot();
    ordered_snapshot.markets[0].reference_price = 10_000;
    ordered_snapshot.markets[0].lower = 10_000;
    ordered_snapshot.markets[0].upper = 10_000;
    ordered_snapshot.risks[0].lower = 10_000;
    ordered_snapshot.risks[0].upper = 10_000;
    account.cash = 3_000;
    account.positions[0].virtual_scaled = -10_000 * SCALE;
    account.book.last_order_id = 1;
    account.book.orders[0].order = crate::state::OrderRecord {
        id: 1,
        version: 1,
        state: 1,
        side: 0,
        original_lots: 1,
        lots: 1,
        limit: 10_000,
        fee_budget: 1,
        start_slot: 90,
        expiry_slot: 200,
        terms_epoch: 1,
        ..Default::default()
    };
    // 1,000 position IM + 1,000 pending-order IM + one reserved fee atom.
    let next = withdraw_candidate(&account, &ordered_snapshot, 999).unwrap();
    assert_eq!(next.reserved, 1_001);
    assert_eq!(next.cash, 2_001);
    assert!(withdraw_candidate(&account, &ordered_snapshot, 1_000).is_err());
}

#[test]
fn collection_cannot_prefer_one_market_of_an_underfunded_shared_debtor() {
    let snapshot = fixture_snapshot();
    for selected in [0, 1] {
        assert!(claim_candidate(
            &root(100, [-80 * SCALE, -40 * SCALE]),
            &snapshot,
            selected,
            1,
            false,
            0
        )
        .is_err());
    }
    let (next, pool) = claim_candidate(
        &root(120, [-80 * SCALE, -40 * SCALE]),
        &snapshot,
        0,
        80,
        false,
        0,
    )
    .unwrap();
    assert_eq!((next.cash, pool), (40, 80));
    assert_eq!(
        next.positions.map(|position| position.virtual_scaled),
        [0, -40 * SCALE]
    );
}

#[test]
fn normal_collection_and_payment_keep_each_fraction_owned() {
    let snapshot = fixture_snapshot();
    let fraction = SCALE / 3;
    let (debit, pool) =
        claim_candidate(&root(2, [-SCALE - fraction, 0]), &snapshot, 0, 1, false, 0).unwrap();
    assert_eq!(
        (debit.cash, pool, debit.positions[0].virtual_scaled),
        (1, 1, -fraction)
    );
    let (credit, pool) =
        claim_candidate(&root(7, [SCALE + fraction, 0]), &snapshot, 0, 1, true, pool).unwrap();
    assert_eq!(
        (credit.cash, pool, credit.positions[0].virtual_scaled),
        (8, 0, fraction)
    );
    assert!(claim_candidate(&root(7, [SCALE + fraction, 0]), &snapshot, 0, 2, true, 2).is_err());
    assert!(claim_candidate(&root(7, [SCALE + fraction, 0]), &snapshot, 0, 1, true, 0).is_err());
}

#[test]
fn funded_netting_moves_exact_backing_and_never_creates_cash() {
    let snapshot = fixture_snapshot();
    let account = root(10, [75 * SCALE + 1, -60 * SCALE - 2]);
    let (next, pools) = net_candidate(&account, &snapshot, 0, 60, [75, 0]).unwrap();
    assert_eq!((next.cash, pools), (10, [15, 60]));
    assert_eq!(
        next.positions.map(|position| position.virtual_scaled),
        [15 * SCALE + 1, -2]
    );
    assert!(net_candidate(&account, &snapshot, 0, 60, [0, 0]).is_err());
    assert!(net_candidate(&account, &snapshot, 0, 61, [75, 0]).is_err());
    let mut exposed = account.clone();
    exposed.positions[0].lots = 1;
    exposed.positions[0].generation = 1;
    assert!(net_candidate(&exposed, &snapshot, 0, 1, [75, 0]).is_err());
    let mut historical = account;
    historical.book.protections[0].protection.remaining = 1;
    // No live order references this historical allowance. Signed acceptance
    // separately creates/cancels real TP/SL before closing and netting.
    assert!(net_candidate(&historical, &snapshot, 0, 1, [75, 0]).is_ok());
}

#[test]
fn unrelated_insolvency_is_not_a_market_payment_veto() {
    let snapshot = fixture_snapshot();
    let eth_debtor = root(0, [0, -100 * SCALE]);
    assert_eq!(
        certificate::debtor_mask(&eth_debtor, &snapshot, 0).unwrap(),
        0
    );
    assert!(certificate::debtor_mask(&eth_debtor, &snapshot, 1).is_err());
    let cross_debtor = root(100, [-80 * SCALE, -40 * SCALE]);
    for selected in [0, 1] {
        assert!(certificate::debtor_mask(&cross_debtor, &snapshot, selected).is_err());
    }
    let backed = root(120, [-80 * SCALE, -40 * SCALE]);
    for selected in [0, 1] {
        assert_eq!(
            certificate::debtor_mask(&backed, &snapshot, selected).unwrap(),
            0
        );
    }
}

#[test]
fn cash_receipt_consumes_funding_without_requiring_recipient_health() {
    let mut account = root(0, [-100 * SCALE, 0]);
    account.positions[0].lots = 1;
    account.positions[0].generation = 1;
    let mut snapshot = fixture_snapshot();
    snapshot.markets[0].valid_until = 0;
    snapshot.markets[0].funding_index_scaled = SCALE / 3;
    snapshot.markets[0].oracle.funding_base = SCALE / 3;
    snapshot.risks[0].funding = SCALE / 3;
    let next = receive_candidate(&account, &snapshot, 1).unwrap();
    assert_eq!(next.cash, 1);
    assert_eq!(next.positions[0].virtual_scaled, -100 * SCALE - SCALE / 3);
    assert_eq!(next.positions[0].funding_checkpoint_scaled, SCALE / 3);
    assert!(crate::engine::account::model(&next)
        .unwrap()
        .admissible(snapshot.risks)
        .is_err());
}

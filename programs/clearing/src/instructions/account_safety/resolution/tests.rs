//! Literal expectations against the functions called by the frozen handlers.
//! Signed accounts, source authentication and resource limits require runtime tests.
use super::*;
use crate::state::Position;
use math::{oracle::Bounds, SCALE};

fn root(id: u16, cash: u64, claims: [i128; 2]) -> MarginAccount {
    MarginAccount {
        schema_version: 5,
        id,
        cash,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        delegate_epoch: 1,
        positions: claims.map(|claim| Position {
            virtual_scaled: claim,
            generation: 4,
            ..Default::default()
        }),
        ..Default::default()
    }
}
fn markets() -> [Market; 2] {
    [Market::default(), Market::default()]
}
fn bounds() -> [Option<Bounds>; 2] {
    [Some(Bounds {
        reference: 100,
        lower: 90,
        upper: 110,
        normal: true,
        deadline: 1020,
    }); 2]
}

#[test]
fn only_bankruptcy_or_unpaid_flat_gross_debt_is_permissionless() {
    let markets = markets();
    let mut target = root(0, 1, [-102 * SCALE, 0]);
    target.positions[0].lots = 1; // common net = -1: actual bankruptcy.
    assert!(freeze::authorized_prices(
        &target,
        markets.each_ref(),
        bounds(),
        [0; 2],
        false,
        false,
        1000
    )
    .is_ok());
    target.positions[0].virtual_scaled = -100 * SCALE;
    // Common net +1, conservative risk -9 and MM deficit: liquidation, not default.
    assert!(freeze::authorized_prices(
        &target,
        markets.each_ref(),
        bounds(),
        [0; 2],
        false,
        true,
        1000
    )
    .is_err());
    let flat = root(0, 0, [-10 * SCALE, 10 * SCALE]);
    assert_eq!(
        freeze::authorized_prices(
            &flat,
            markets.each_ref(),
            [None; 2],
            [0; 2],
            false,
            false,
            1000
        )
        .unwrap(),
        [1; 2]
    );
    let backed = root(0, 10, [-10 * SCALE, 10 * SCALE]);
    assert!(freeze::authorized_prices(
        &backed,
        markets.each_ref(),
        [None; 2],
        [0; 2],
        false,
        false,
        1000
    )
    .is_err());
    let fractional = root(0, 10, [-10 * SCALE - 1, 11 * SCALE]);
    assert!(freeze::authorized_prices(
        &fractional,
        markets.each_ref(),
        [None; 2],
        [0; 2],
        false,
        false,
        1000
    )
    .is_ok());
}

#[test]
fn emergency_requires_exposed_missing_source_authority_and_full_grace() {
    let mut markets = markets();
    markets[1].gross_lots = 2;
    markets[1].oracle.source_deadline = 1000;
    let target = root(0, 50, [0; 2]);
    for (authority, now) in [(false, 1030), (true, 1029)] {
        assert!(freeze::authorized_prices(
            &target,
            markets.each_ref(),
            [bounds()[0], None],
            [0; 2],
            true,
            authority,
            now
        )
        .is_err());
    }
    assert_eq!(
        freeze::authorized_prices(
            &target,
            markets.each_ref(),
            [bounds()[0], None],
            [0; 2],
            true,
            true,
            1030
        )
        .unwrap(),
        [0; 2]
    );
    assert!(freeze::authorized_prices(
        &target,
        markets.each_ref(),
        bounds(),
        [0; 2],
        true,
        true,
        1030
    )
    .is_err());
    markets[1].gross_lots = 0;
    assert!(freeze::authorized_prices(
        &target,
        markets.each_ref(),
        [None; 2],
        [0; 2],
        true,
        true,
        1030
    )
    .is_err());
}

#[test]
fn valid_target_does_not_authorize_valuing_another_exposed_market_without_a_price() {
    let mut markets = markets();
    markets[1].gross_lots = 2;
    let target = root(0, 0, [-SCALE, 0]);
    assert_eq!(
        freeze::authorized_prices(
            &target,
            markets.each_ref(),
            [bounds()[0], None],
            [0; 2],
            false,
            false,
            1000
        )
        .unwrap(),
        [0; 2]
    );
    let mut exposed = target;
    exposed.positions[1].lots = 1;
    assert!(freeze::authorized_prices(
        &exposed,
        markets.each_ref(),
        [bounds()[0], None],
        [0; 2],
        false,
        false,
        1000
    )
    .is_err());
}

#[test]
fn frozen_value_consumes_both_fractional_funding_endpoints_and_reconciles() {
    let mut header = Resolution {
        count: 2,
        prices: [100, 200],
        funding: [SCALE / 3, -SCALE / 7],
        cash_before: 15,
        remaining_gross: [6, 4],
        ..Default::default()
    };
    let mut debtor = root(0, 5, [-300 * SCALE, 400 * SCALE]);
    debtor.positions[0].lots = 3;
    debtor.positions[1].lots = -2;
    let mut creditor = root(1, 10, [300 * SCALE, -400 * SCALE]);
    creditor.positions[0].lots = -3;
    creditor.positions[1].lots = 2;
    let mut row = ResolutionRow::default();
    pages::value_row(&mut header, &mut row, Pubkey::new_unique(), &debtor).unwrap();
    assert_eq!(row.claims_scaled, [-999_999_999, -285_714_284]);
    assert_eq!(row.collected, 1); // Own fractional debts combine before atom collection.
    assert_eq!(row.generations, [4, 4]);
    pages::value_row(&mut header, &mut row, Pubkey::new_unique(), &creditor).unwrap();
    header.cursor = 2;
    pages::finish_value(&mut header).unwrap();
    assert_eq!((header.stage, header.cursor), (DENOMINATOR, 0));
    assert_eq!(header.positive_scaled, [999_999_999, 285_714_284]);
    assert_eq!(header.common.limbs[0], 1);
    assert_eq!(debtor.cash, 5);
    assert_eq!(debtor.positions[0].funding_checkpoint_scaled, 0); // No live apply.
}

#[test]
fn omitted_or_corrupted_cohort_sums_never_advance() {
    for altered in 0..5 {
        let mut header = Resolution {
            count: 2,
            cursor: 2,
            cash_before: 9,
            scanned_cash: 9,
            remaining_gross: [4, 2],
            scanned_gross: [4, 2],
            pools_before: [3, 0],
            claim_sums: [3 * SCALE, 0],
            ..Default::default()
        };
        match altered {
            0 => header.cursor = 1,
            1 => header.scanned_cash = 8,
            2 => header.scanned_lots[1] = 1,
            3 => header.scanned_gross[0] = 2,
            _ => header.claim_sums[0] -= 1,
        }
        assert!(pages::finish_value(&mut header).is_err());
    }
}

#[test]
fn page_range_authenticates_every_legal_count_and_cursor() {
    for stage in [VALUE, DENOMINATOR, VERIFY, FLOW_PLAN, APPLY, RECONCILE] {
        for count in 1..=64 {
            for start in 0..count {
                let header = Resolution {
                    stage,
                    cursor: start,
                    count,
                    ..Default::default()
                };
                let page = ResolutionPage {
                    schema_version: 5,
                    page_index: start / 2,
                    ..Default::default()
                };
                for length in 0..=3 {
                    let expected = (1..=2).contains(&length)
                        && (!matches!(stage, VERIFY | FLOW_PLAN) || length == 1)
                        && start + u16::from(length) <= count
                        && start % 2 + u16::from(length) <= 2;
                    assert_eq!(
                        pages::test_page_range(&header, &page, stage, start, length).is_ok(),
                        expected
                    );
                }
                assert!(pages::test_page_range(&header, &page, 255, start, 1).is_err());
                assert!(pages::test_page_range(&header, &page, stage, start + 1, 1).is_err());
            }
        }
    }
}

#[test]
fn registry_hash_binds_version_order_count_and_uniqueness() {
    let first = Pubkey::new_unique();
    let second = Pubkey::new_unique();
    let mut registry = VenueRegistry {
        schema_version: 5,
        count: 2,
        membership_version: 1,
        members: vec![first, second],
        ..Default::default()
    };
    let original = registry_hash(&registry).unwrap();
    registry.members.swap(0, 1);
    assert_ne!(registry_hash(&registry).unwrap(), original);
    registry.members.swap(0, 1);
    registry.membership_version = 2;
    assert_ne!(registry_hash(&registry).unwrap(), original);
    registry.members[1] = first;
    assert!(registry_hash(&registry).is_err());
    registry.members[1] = second;
    registry.count = 1;
    assert!(registry_hash(&registry).is_err());
}

fn cohort(
    inputs: &[(u64, [i128; 2])],
    insurance: [u64; 2],
) -> (Resolution, ResolutionWork, Vec<ResolutionRow>) {
    let mut header = Resolution {
        stage: RATE_PROPOSAL,
        count: inputs.len() as u16,
        budgets: insurance,
        insurance_before: insurance,
        ..Default::default()
    };
    wide::set_u128(&mut header.common.limbs, 1);
    let rows = inputs
        .iter()
        .map(|(cash, claims)| {
            let model = Row {
                cash: *cash,
                claims: *claims,
            };
            model.denominator(&mut header.common.limbs).unwrap();
            for index in 0..2 {
                header.positive_scaled[index] += claims[index].max(0) as u128;
            }
            ResolutionRow {
                cash_before: *cash,
                claims_scaled: *claims,
                collected: model.collected().unwrap(),
                ..Default::default()
            }
        })
        .collect();
    (header, ResolutionWork::default(), rows)
}
fn proposal_bytes(numerators: [u128; 2], factor: u128) -> Vec<u8> {
    let mut bytes = vec![0; 1560];
    for (index, numerator) in numerators.into_iter().enumerate() {
        bytes[index * 768..index * 768 + 16].copy_from_slice(&numerator.to_le_bytes());
    }
    bytes[1536..1552].copy_from_slice(&factor.to_le_bytes());
    bytes
}
fn propose(
    header: &mut Resolution,
    work: &mut ResolutionWork,
    numerators: [u128; 2],
    factor: u128,
) -> u8 {
    let bytes = proposal_bytes(numerators, factor);
    let hash = solana_sha256_hasher::hash(&bytes).to_bytes();
    let mut result = 0;
    for (index, chunk) in bytes.chunks(512).enumerate() {
        result = rates::chunk(
            header,
            work,
            header.evaluation,
            hash,
            (index * 512) as u16,
            chunk,
        )
        .unwrap();
    }
    result
}
fn verify(header: &mut Resolution, work: &mut ResolutionWork, rows: &mut [ResolutionRow]) -> u8 {
    assert_eq!(header.stage, VERIFY);
    for row in rows {
        rates::verify_row(header, work, row).unwrap();
    }
    header.cursor = header.count;
    rates::finish(header, work)
}

#[test]
fn valid_fixed_but_not_greatest_cashless_cycle_resets_then_can_complete() {
    let (mut header, mut work, mut rows) = cohort(
        &[
            (0, [100 * SCALE, -100 * SCALE]),
            (0, [-100 * SCALE, 100 * SCALE]),
        ],
        [0; 2],
    );
    for numerators in [[0, 0], [1, 1]] {
        assert_eq!(propose(&mut header, &mut work, numerators, 2), 0);
        assert_eq!(verify(&mut header, &mut work, &mut rows), 1);
        assert_eq!(header.stage, RATE_PROPOSAL);
        assert_eq!(header.insurance_spent, [0; 2]);
        assert_eq!(header.evaluation, 0); // Malicious proposals cannot use clip budget.
    }
    propose(&mut header, &mut work, [1, 1], 1);
    assert_eq!(verify(&mut header, &mut work, &mut rows), 3);
    assert_eq!(header.stage, FLOW_PLAN);
    assert_eq!(
        rows[0].exact_flow_numerators[0].limbs[0],
        100 * SCALE as u64
    );
    assert_eq!(
        rows[0].exact_flow_numerators[1].limbs[0],
        100 * SCALE as u64
    );
}

#[test]
fn prescribed_insurance_clipping_requires_three_complete_evaluations() {
    // Independently solved responses: (1,1) uses (0,3/5); clipping I1 gives
    // (1,1/4) using (9/20,0); clipping I0 then gives (0,0), no integral use.
    let (mut header, mut work, mut rows) = cohort(
        &[
            (2, [0, 0]),
            (2, [2 * SCALE / 5, SCALE / 5]),
            (1, [-3 * SCALE / 5, 3 * SCALE / 5]),
            (2, [SCALE / 5, -4 * SCALE / 5]),
        ],
        [1, 1],
    );
    for (evaluation, numerators, factor, expected, mask) in
        [(0, [1, 1], 1, [1, 0], 2), (1, [4, 1], 4, [0, 0], 3)]
    {
        assert_eq!(header.evaluation, evaluation);
        propose(&mut header, &mut work, numerators, factor);
        assert_eq!(verify(&mut header, &mut work, &mut rows), 2);
        assert_eq!(header.budgets, expected);
        assert_eq!(header.clipped_mask, mask);
        assert_eq!(header.insurance_before, [1, 1]);
        assert_eq!(header.insurance_spent, [0, 0]);
    }
    propose(&mut header, &mut work, [0, 0], 1);
    assert_eq!(verify(&mut header, &mut work, &mut rows), 3);
    assert_eq!(header.evaluation, 2);
    assert_eq!(header.insurance_spent, [0, 0]);
}

#[test]
fn chunk_authority_rejects_missing_changed_stale_and_overlarge_proofs() {
    let (mut header, mut work, _) = cohort(&[(0, [0, 0])], [0, 0]);
    let bytes = proposal_bytes([1, 1], 1);
    let hash = solana_sha256_hasher::hash(&bytes).to_bytes();
    assert!(rates::chunk(&mut header, &mut work, 0, hash, 512, &bytes[512..1024]).is_err());
    assert!(rates::chunk(&mut header, &mut work, 0, hash, 0, &bytes[..520]).is_err());
    assert!(rates::chunk(&mut header, &mut work, 1, hash, 0, &bytes[..512]).is_err());
    rates::chunk(&mut header, &mut work, 0, hash, 0, &bytes[..512]).unwrap();
    assert!(rates::chunk(&mut header, &mut work, 0, [9; 32], 512, &bytes[512..1024]).is_err());
    assert!(rates::chunk(&mut header, &mut work, 0, hash, 1024, &bytes[1024..1536]).is_err());
    // Anyone can replace an abandoned incomplete upload, but not verification.
    assert_eq!(propose(&mut header, &mut work, [1, 1], 1), 0);
    assert_eq!(header.stage, VERIFY);
    assert!(rates::chunk(&mut header, &mut work, 0, hash, 0, &bytes[..512]).is_err());
}

#[test]
fn bad_complete_encoding_and_bad_fixed_equation_reset_without_spending() {
    let (mut header, mut work, mut rows) =
        cohort(&[(0, [-10 * SCALE, 0]), (0, [10 * SCALE, 0])], [3, 0]);
    assert_eq!(propose(&mut header, &mut work, [1, 1], 0), 1);
    assert_eq!(header.stage, RATE_PROPOSAL);
    assert_eq!(propose(&mut header, &mut work, [2, 1], 1), 1);
    propose(&mut header, &mut work, [1, 1], 1); // Valid bound, wrong fixed equation.
    assert_eq!(verify(&mut header, &mut work, &mut rows), 1);
    assert_eq!(header.budgets, [3, 0]);
    propose(&mut header, &mut work, [3, 10], 10);
    assert_eq!(verify(&mut header, &mut work, &mut rows), 3);
    assert_eq!(header.insurance_spent, [3, 0]);
    assert_eq!(header.insurance_before, [3, 0]); // Still a plan, never live ledger mutation.
}

#[test]
fn application_preserves_other_cash_and_accounts_for_insurance_once() {
    // Creditor has 20 unpaid atoms; bankrupt debtor owns only 10 cash, and its
    // market contributes exactly 3 insurance. Unrelated cash5 is never seized.
    let mut header = Resolution {
        stage: APPLY,
        count: 3,
        prices: [1; 2],
        cash_before: 15,
        scanned_cash: 15,
        insurance_before: [3, 9],
        insurance_spent: [3, 0],
        ..Default::default()
    };
    let work = ResolutionWork::default();
    let mut roots = [
        root(0, 10, [-20 * SCALE, 0]),
        root(1, 0, [20 * SCALE, 0]),
        root(2, 5, [0, 0]),
    ];
    let mut rows = [
        ResolutionRow {
            cash_before: 10,
            claims_scaled: [-20 * SCALE, 0],
            generations: [4; 2],
            collected: 10,
            rounded_flows: [10, 0],
            cash_after: 0,
            ..Default::default()
        },
        ResolutionRow {
            claims_scaled: [20 * SCALE, 0],
            generations: [4; 2],
            rounded_flows: [13, 0],
            cash_after: 13,
            ..Default::default()
        },
        ResolutionRow {
            cash_before: 5,
            generations: [4; 2],
            cash_after: 5,
            ..Default::default()
        },
    ];
    roots[0].delegate = Pubkey::new_unique();
    roots[0].delegate_expiry_slot = 123;
    roots[0].book.last_order_id = 81;
    for index in 0..3 {
        application::apply_row(
            &mut header,
            &work,
            &mut rows[index],
            &mut roots[index],
            index,
        )
        .unwrap();
        header.cursor += 1;
        assert!(application::apply_row(
            &mut header,
            &work,
            &mut rows[index],
            &mut roots[index],
            index
        )
        .is_err());
    }
    application::check_complete_plan(&header).unwrap();
    assert_eq!(roots.map(|root| root.cash), [0, 13, 5]);
    assert_eq!(header.cash_applied, 18);
    assert_eq!(header.claim_sums, [3 * SCALE, 0]);
    assert_eq!(header.insurance_before, [3, 9]); // Scalar planning never spends a live ledger.
    let mut debtor = root(0, 10, [-20 * SCALE, 0]);
    debtor.delegate = Pubkey::new_unique();
    debtor.delegate_expiry_slot = 123;
    debtor.book.last_order_id = 81;
    let mut one = Resolution {
        stage: APPLY,
        count: 1,
        prices: [1; 2],
        scanned_cash: 10,
        ..Default::default()
    };
    let mut row = ResolutionRow {
        cash_before: 10,
        claims_scaled: [-20 * SCALE, 0],
        generations: [4; 2],
        collected: 10,
        rounded_flows: [10, 0],
        ..Default::default()
    };
    application::apply_row(&mut one, &work, &mut row, &mut debtor, 0).unwrap();
    assert_eq!(
        (debtor.nonce, debtor.state_version, debtor.delegate_epoch),
        (1, 1, 2)
    );
    assert_eq!(debtor.delegate, Pubkey::default());
    assert_eq!(debtor.delegate_expiry_slot, 0);
    assert_eq!(debtor.book.last_order_id, 81);
    assert_eq!(debtor.positions.map(|position| position.generation), [5, 5]);
}

#[test]
fn closed_cycle_applies_without_a_cash_mint_or_cross_market_haircut() {
    let mut header = Resolution {
        stage: APPLY,
        count: 2,
        prices: [1; 2],
        ..Default::default()
    };
    let work = ResolutionWork::default();
    for (id, claims) in [[10 * SCALE, -10 * SCALE], [-10 * SCALE, 10 * SCALE]]
        .into_iter()
        .enumerate()
    {
        let mut account = root(id as u16, 0, claims);
        let mut row = ResolutionRow {
            claims_scaled: claims,
            generations: [4; 2],
            rounded_flows: [10, 10],
            ..Default::default()
        };
        application::apply_row(&mut header, &work, &mut row, &mut account, id).unwrap();
        assert_eq!(account.cash, 0);
        assert!(account
            .positions
            .iter()
            .all(|position| position.virtual_scaled == 0));
        header.cursor += 1;
    }
    application::check_complete_plan(&header).unwrap();
    assert_eq!(header.cash_applied, 0);
    assert_eq!(header.claim_sums, [0; 2]);
}

#[test]
fn terminal_reconciliation_rejects_residual_claims_or_revived_authority() {
    let mut header = Resolution {
        stage: RECONCILE,
        funding: [17, -23],
        ..Default::default()
    };
    let row = ResolutionRow {
        applied: true,
        cash_after: 7,
        generations: [4; 2],
        ..Default::default()
    };
    let mut account = root(0, 7, [0; 2]);
    for (index, position) in account.positions.iter_mut().enumerate() {
        position.generation = 5;
        position.funding_checkpoint_scaled = header.funding[index];
    }
    application::reconcile_row(&mut header, &row, &account).unwrap();
    assert_eq!(header.scanned_cash, 7);
    account.positions[1].virtual_scaled = 1;
    assert!(application::reconcile_row(&mut header, &row, &account).is_err());
    account.positions[1].virtual_scaled = 0;
    account.delegate = Pubkey::new_unique();
    assert!(application::reconcile_row(&mut header, &row, &account).is_err());
}

#[test]
fn isolated_application_keeps_the_forbidden_market_slot_empty() {
    let mut header = Resolution {
        stage: APPLY,
        count: 1,
        prices: [1; 2],
        funding: [17, -23],
        cash_before: 9,
        scanned_cash: 9,
        ..Default::default()
    };
    let work = ResolutionWork::default();
    let mut account = root(0, 9, [0; 2]);
    account.mode = MODE_ISOLATED;
    account.subaccount_index = 1;
    account.isolated_market_index = 0;
    account.positions[1] = Position::default();
    let mut row = ResolutionRow {
        cash_before: 9,
        cash_after: 9,
        generations: [4, 0],
        ..Default::default()
    };
    application::apply_row(&mut header, &work, &mut row, &mut account, 0).unwrap();
    assert_eq!(account.positions[0].funding_checkpoint_scaled, 17);
    assert_eq!(account.positions[0].generation, 5);
    assert_eq!(account.positions[1].lots, 0);
    assert_eq!(account.positions[1].funding_checkpoint_scaled, 0);
    assert_eq!(account.positions[1].generation, 0);
    header.scanned_cash = 0;
    application::reconcile_row(&mut header, &row, &account).unwrap();
}

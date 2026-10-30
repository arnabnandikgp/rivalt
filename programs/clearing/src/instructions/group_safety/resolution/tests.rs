use super::*;
mod cross;

fn root(
    id: u16,
    index: usize,
    cash: u64,
    lots: i64,
    claim: i128,
    price: u64,
    funding: i128,
) -> MarginAccountV2 {
    let mut root = MarginAccountV2 {
        schema_version: SCHEMA_VERSION,
        subaccount_index: 1,
        id,
        mode: MODE_ISOLATED,
        isolated_market_index: index as u8,
        role: ROLE_TRADER,
        cash,
        delegate_epoch: 1,
        ..Default::default()
    };
    root.positions[index] = Position {
        lots,
        virtual_scaled: claim - i128::from(lots) * i128::from(price) * math::SCALE
            + i128::from(lots) * funding,
        generation: u64::from(lots != 0),
        ..Default::default()
    };
    root
}
fn plan(
    roots: &[MarginAccountV2],
    insurance: u64,
    fees: u64,
    prices: [u64; 2],
    funding: [i128; 2],
) -> (ClearingGroupV2, [GroupMarketV2; 2], GroupResolutionV2) {
    let cash = roots.iter().map(|root| root.cash).sum();
    let gross = [0, 1].map(|index| {
        roots
            .iter()
            .map(|root| root.positions[index].lots.unsigned_abs())
            .sum()
    });
    let group = ClearingGroupV2 {
        mode: 3,
        paused: true,
        total_cash: cash,
        insurance,
        fees,
        allocated_vault: cash + insurance + fees,
        ..Default::default()
    };
    let markets = [0, 1].map(|index| GroupMarketV2 {
        schema_version: SCHEMA_VERSION,
        index: index as u8,
        gross_lots: gross[index],
        funding_index_scaled: funding[index],
        ..Default::default()
    });
    let resolution = GroupResolutionV2 {
        header: GroupResolutionHeaderV2 {
            stage: VALUE,
            count: roots.len() as u16,
            prices,
            funding,
            initial_cash: cash,
            initial_insurance: insurance,
            initial_fees: fees,
            initial_vault: group.allocated_vault,
            remaining_gross: gross,
            ..Default::default()
        },
        rows: vec![GroupResolutionRowV2::default(); roots.len()],
        ..Default::default()
    };
    (group, markets, resolution)
}
fn run(
    roots: &mut [MarginAccountV2],
    group: &mut ClearingGroupV2,
    markets: &mut [GroupMarketV2; 2],
    state: &mut GroupResolutionV2,
    page_size: usize,
) {
    while state.header.stage <= RECONCILE {
        let stage = state.header.stage;
        for start in (0..roots.len()).step_by(page_size) {
            let end = (start + page_size).min(roots.len());
            for id in start..end {
                let [btc, eth] = markets;
                ledger::process_row(group, &mut [btc, eth], state, id, &mut roots[id]).unwrap();
            }
            state.header.cursor = end as u16;
            cash_invariant(group, &state.header, state.header.initial_vault).unwrap();
            assert_eq!(state.header.stage, stage);
        }
        let [btc, eth] = markets;
        ledger::finish_pass(group, &mut [btc, eth], &mut state.header).unwrap();
    }
    assert_eq!(state.header.stage, COMPLETE);
    cash_invariant(group, &state.header, state.header.initial_vault).unwrap();
}

#[test]
fn two_market_waterfall_keeps_healthy_sibling_cash_and_exact_fraction_ownership() {
    for page_size in 1..=4 {
        let mut roots = vec![
            root(0, 0, 2, -2, -8_500_000_000, 10_000, 17),
            root(1, 0, 10, 2, 5_250_000_000, 10_000, 17),
            root(2, 1, 10, -3, 3_250_000_000, 20_000, -19),
            root(3, 1, 100, 3, 0, 20_000, -19),
            MarginAccountV2 {
                schema_version: SCHEMA_VERSION,
                id: 4,
                mode: MODE_CROSS,
                isolated_market_index: CROSS_MARKET_SENTINEL,
                cash: 7,
                delegate_epoch: 1,
                ..Default::default()
            },
        ];
        let (mut group, mut markets, mut state) = plan(&roots, 1, 3, [10_000, 20_000], [17, -19]);
        run(&mut roots, &mut group, &mut markets, &mut state, page_size);
        assert_eq!(
            roots.iter().map(|root| root.cash).collect::<Vec<_>>(),
            [0, 12, 11, 100, 7]
        );
        assert_eq!(
            (
                group.total_cash,
                group.settlement,
                group.insurance,
                group.fees,
                group.allocated_vault
            ),
            (130, 0, 0, 3, 133)
        );
        assert_eq!(
            (
                state.header.collected_total,
                state.header.insured_atoms,
                state.header.plan_pool,
                state.header.paid_applied
            ),
            (2, 1, 3, 3)
        );
        assert_eq!(
            state
                .rows
                .iter()
                .map(|row| row.insured_scaled)
                .collect::<Vec<_>>(),
            [1_000_000_000, 0, 0, 0, 0]
        );
        assert_eq!(
            state
                .rows
                .iter()
                .map(|row| row.impaired_scaled)
                .collect::<Vec<_>>(),
            [0, 3_397_058_824, 2_102_941_176, 0, 0]
        );
        assert_eq!(
            state
                .rows
                .iter()
                .map(|row| row.rounding_scaled)
                .collect::<Vec<_>>(),
            [0, 147_058_824, -147_058_824, 0, 0]
        );
        assert_eq!(roots[0].positions[0].generation, 2);
        assert_eq!(roots[2].positions[1].generation, 2);
        assert!(roots
            .iter()
            .flat_map(|root| root.positions)
            .all(|position| position.lots == 0 && position.virtual_scaled == 0));
        assert_eq!(state.header.remaining_gross, [0, 0]);
    }
}

#[test]
fn full_sixty_four_member_ties_pay_only_stable_id_winners() {
    let mut roots = (0..64)
        .map(|id| {
            root(
                id,
                usize::from(id % 2),
                1,
                0,
                if id < 32 { 500_000_000 } else { -500_000_000 },
                10_000,
                0,
            )
        })
        .collect::<Vec<_>>();
    let (mut group, mut markets, mut state) = plan(&roots, 16, 7, [10_000; 2], [0; 2]);
    run(&mut roots, &mut group, &mut markets, &mut state, 4);
    for (id, root) in roots.iter().enumerate() {
        assert_eq!(root.cash, if id < 16 { 2 } else { 1 });
    }
    assert_eq!(
        (
            group.total_cash,
            group.insurance,
            group.fees,
            group.allocated_vault
        ),
        (80, 0, 7, 87)
    );
    assert_eq!(state.header.rounding_sum, 0);
    assert!(state.rows[..16]
        .iter()
        .all(|row| row.rounding_scaled == 500_000_000));
    assert!(state.rows[16..32]
        .iter()
        .all(|row| row.rounding_scaled == -500_000_000));
    assert!(state.rows[32..]
        .iter()
        .all(|row| row.insured_scaled == 500_000_000 && row.paid == 0));
}

#[test]
fn terminal_derived_claim_beyond_stored_virtual_bound_resolves() {
    let mut roots = vec![
        root(0, 0, 0, 0, math::MAX_SCALED, math::MAX_PRICE, 0),
        root(1, 0, 0, 0, -math::MAX_SCALED, math::MAX_PRICE, 0),
    ];
    roots[0].positions[0].lots = math::MAX_LOTS;
    roots[1].positions[0].lots = -math::MAX_LOTS;
    for root in &mut roots {
        root.positions[0].funding_checkpoint_scaled = math::MAX_FUNDING;
    }
    let (mut group, mut markets, mut state) =
        plan(&roots, 0, 0, [math::MAX_PRICE; 2], [-math::MAX_FUNDING, 0]);
    assert!(account_model(&roots[0])
        .unwrap()
        .accrued([-math::MAX_FUNDING, 0])
        .is_err());
    run(&mut roots, &mut group, &mut markets, &mut state, 1);
    assert_eq!(
        state.rows[0].claim_scaled,
        100_300_000_000_000_000_000_000_000
    );
    assert_eq!(
        state.rows[0].impaired_scaled,
        100_300_000_000_000_000_000_000_000
    );
    assert_eq!(group.total_cash, 0);
}

#[test]
fn wrong_member_and_mutated_frozen_claim_reject_before_collection() {
    let mut roots = vec![
        root(0, 0, 1, 0, -math::SCALE, 10_000, 0),
        root(1, 1, 1, 0, math::SCALE, 10_000, 0),
    ];
    let (mut group, mut markets, mut state) = plan(&roots, 0, 0, [10_000; 2], [0; 2]);
    let [btc, eth] = &mut markets;
    assert!(
        ledger::process_row(&mut group, &mut [btc, eth], &mut state, 1, &mut roots[0]).is_err()
    );
    for (id, root) in roots.iter_mut().enumerate() {
        let [btc, eth] = &mut markets;
        ledger::process_row(&mut group, &mut [btc, eth], &mut state, id, root).unwrap();
    }
    let [btc, eth] = &mut markets;
    ledger::finish_pass(&mut group, &mut [btc, eth], &mut state.header).unwrap();
    roots[0].positions[0].virtual_scaled -= 1;
    let [btc, eth] = &mut markets;
    assert!(
        ledger::process_row(&mut group, &mut [btc, eth], &mut state, 0, &mut roots[0]).is_err()
    );
}

#[test]
fn dormant_cross_cannot_hide_a_claim_or_order_in_group_recovery() {
    let mut root = MarginAccountV2 {
        schema_version: SCHEMA_VERSION,
        mode: MODE_CROSS,
        isolated_market_index: CROSS_MARKET_SENTINEL,
        cash: 7,
        delegate_epoch: 1,
        ..Default::default()
    };
    account_model(&root).unwrap();
    root.positions[1].virtual_scaled = 1;
    assert_eq!(account_model(&root).is_ok(), cross_profile_enabled());
    root.positions[1].virtual_scaled = 0;
    root.book.orders[0].order.state = crate::constants::orders::OPEN;
    assert_eq!(account_model(&root).is_ok(), cross_profile_enabled());
}

//! Literal successor goldens against the actual paginated ledger. Inputs specify
//! terminal claims independently; no expected allocation calls financial_core.
use super::*;
use crate::instructions::group_margin::model;

fn cross(
    id: u16,
    cash: u64,
    lots: [i64; 2],
    claims: [i128; 2],
    prices: [u64; 2],
    funding: [i128; 2],
) -> MarginAccountV2 {
    let mut account = MarginAccountV2 {
        schema_version: SCHEMA_VERSION,
        subaccount_index: 0,
        id,
        mode: MODE_CROSS,
        isolated_market_index: CROSS_MARKET_SENTINEL,
        role: ROLE_TRADER,
        cash,
        delegate_epoch: 1,
        ..Default::default()
    };
    for index in 0..2 {
        account.positions[index] = PositionV2 {
            lots: lots[index],
            virtual_scaled: claims[index]
                - i128::from(lots[index]) * i128::from(prices[index]) * math::SCALE
                + i128::from(lots[index]) * funding[index],
            generation: u64::from(lots[index] != 0),
            ..Default::default()
        };
    }
    account
}

// Recreate the persisted account boundary at every page, including partial
// collection and partial application. This does not compare two implementations
// of the same allocator: cash/claims/ownership expectations below are literal.
fn restore<T: AccountSerialize + AccountDeserialize>(value: &T) -> T {
    let mut bytes = Vec::new();
    value.try_serialize(&mut bytes).unwrap();
    T::try_deserialize(&mut bytes.as_slice()).unwrap()
}

fn run_with_restarts(
    roots: &mut [MarginAccountV2],
    group: &mut ClearingGroupV2,
    markets: &mut [GroupMarketV2; 2],
    state: &mut GroupResolutionV2,
    page_size: usize,
) {
    let positions = roots.iter().map(|root| root.positions).collect::<Vec<_>>();
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
            *group = restore(group);
            *state = restore(state);
            for market in &mut *markets {
                *market = restore(market);
            }
            for (id, root) in roots.iter_mut().enumerate() {
                *root = restore(root);
                if stage < APPLY || (stage == APPLY && id >= end) {
                    // Collection belongs to the ledger, never to ordinary v/q.
                    assert_eq!(
                        root.positions.map(|position| (
                            position.lots,
                            position.virtual_scaled,
                            position.funding_checkpoint_scaled,
                            position.generation
                        )),
                        positions[id].map(|position| (
                            position.lots,
                            position.virtual_scaled,
                            position.funding_checkpoint_scaled,
                            position.generation
                        )),
                    );
                }
            }
            assert_eq!(usize::from(state.header.cursor), end);
        }
        let [btc, eth] = markets;
        ledger::finish_pass(group, &mut [btc, eth], &mut state.header).unwrap();
        *state = restore(state);
    }
    assert_eq!(state.header.stage, COMPLETE);
    cash_invariant(group, &state.header, state.header.initial_vault).unwrap();
}

#[test]
fn g06_loss_only_risk_is_not_economic_bankruptcy() {
    let account = cross(
        0,
        100,
        [3, -2],
        [300 * math::SCALE, -200 * math::SCALE],
        [1_000; 2],
        [17, -19],
    );
    let risks = [17, -19].map(|funding| math::margin::Risk {
        lower: 1_000,
        upper: 1_000,
        funding,
    });
    let model = model(&account).unwrap();
    assert_eq!(model.risk_equity(risks).unwrap(), -100 * math::SCALE);
    // freeze() uses this economic net calculation, not risk_equity().
    assert_eq!(
        model.net_equity([1_000; 2], [17, -19]).unwrap(),
        200 * math::SCALE
    );
    let bounds = policy::Bounds {
        reference: 1_000,
        lower: 1_000,
        upper: 1_000,
        normal: true,
        deadline: 160,
    };
    let (_, markets, _) = plan(&[account.clone()], 0, 0, [1_000; 2], [17, -19]);
    assert!(freeze_prices(
        &account,
        markets.each_ref(),
        [Some(bounds); 2],
        [17, -19],
        false,
        false,
        150
    )
    .is_err());
    let mut bankrupt = account;
    bankrupt.positions[1].virtual_scaled -= 201 * math::SCALE;
    assert_eq!(
        freeze_prices(
            &bankrupt,
            markets.each_ref(),
            [Some(bounds); 2],
            [17, -19],
            false,
            false,
            150
        )
        .unwrap(),
        [1_000; 2]
    );
}

#[test]
fn missing_source_freeze_requires_authority_exposure_and_full_grace() {
    let account = cross(0, 100, [3, -2], [0; 2], [1_000; 2], [0; 2]);
    let (_, mut markets, _) = plan(&[account.clone()], 0, 0, [1_000; 2], [0; 2]);
    markets[1].oracle.source_deadline = 160;
    let bounds = policy::Bounds {
        reference: 1_000,
        lower: 1_000,
        upper: 1_000,
        normal: true,
        deadline: 200,
    };
    let available = [Some(bounds), None];
    assert!(freeze_prices(
        &account,
        markets.each_ref(),
        available,
        [0; 2],
        true,
        true,
        189
    )
    .is_err());
    assert!(freeze_prices(
        &account,
        markets.each_ref(),
        available,
        [0; 2],
        true,
        false,
        190
    )
    .is_err());
    assert!(freeze_prices(
        &account,
        markets.each_ref(),
        available,
        [0; 2],
        false,
        true,
        190
    )
    .is_err());
    assert_eq!(
        freeze_prices(
            &account,
            markets.each_ref(),
            available,
            [0; 2],
            true,
            true,
            190
        )
        .unwrap(),
        [0; 2]
    );
    markets[1].gross_lots = 0;
    assert!(freeze_prices(
        &account,
        markets.each_ref(),
        available,
        [0; 2],
        true,
        true,
        190
    )
    .is_err());
    markets[1].gross_lots = 2;
    markets[1].oracle.source_deadline = i64::MAX - 10;
    assert!(freeze_prices(
        &account,
        markets.each_ref(),
        available,
        [0; 2],
        true,
        true,
        i64::MAX
    )
    .is_err());
}

#[test]
fn g07_whole_account_terminal_netting_precedes_the_complete_group_waterfall() {
    for page_size in 1..=4 {
        let prices = [1_000, 2_000];
        let funding = [17, -19];
        let mut roots = vec![
            cross(
                0,
                100,
                [3, -2],
                [150 * math::SCALE, -300 * math::SCALE],
                prices,
                funding,
            ),
            root(1, 0, 200, -3, -150 * math::SCALE, prices[0], funding[0]),
            root(2, 1, 100, 2, 300 * math::SCALE, prices[1], funding[1]),
        ];
        let (mut group, mut markets, mut state) = plan(&roots, 20, 0, prices, funding);
        run_with_restarts(&mut roots, &mut group, &mut markets, &mut state, page_size);
        assert_eq!(
            roots.iter().map(|root| root.cash).collect::<Vec<_>>(),
            [0, 50, 370]
        );
        assert_eq!(
            state
                .rows
                .iter()
                .map(|row| row.collected)
                .collect::<Vec<_>>(),
            [100, 150, 0]
        );
        assert_eq!(
            state
                .rows
                .iter()
                .map(|row| row.insured_scaled)
                .collect::<Vec<_>>(),
            [20 * math::SCALE as u128, 0, 0]
        );
        assert_eq!(
            state
                .rows
                .iter()
                .map(|row| row.impaired_scaled)
                .collect::<Vec<_>>(),
            [0, 0, 30 * math::SCALE as u128]
        );
        assert_eq!(
            state.rows.iter().map(|row| row.paid).collect::<Vec<_>>(),
            [0, 0, 270]
        );
        assert_eq!(
            (
                group.total_cash,
                group.insurance,
                group.settlement,
                group.allocated_vault
            ),
            (420, 0, 0, 420)
        );
        assert_eq!(
            roots[0].positions.map(|position| position.generation),
            [2, 2]
        );
        assert!(roots
            .iter()
            .flat_map(|root| root.positions)
            .all(|position| position.lots == 0 && position.virtual_scaled == 0));
        assert_eq!(
            roots[0]
                .positions
                .map(|position| position.funding_checkpoint_scaled),
            funding
        );
        assert_eq!(markets.map(|market| market.gross_lots), [0, 0]);
    }
}

#[test]
fn g08_isolated_default_cannot_collect_healthy_cross_sibling_cash() {
    let owner = Pubkey::new_unique();
    let portfolio = Pubkey::new_unique();
    let mut roots = vec![
        root(0, 0, 10, -1, -100 * math::SCALE, 1_000, 0),
        cross(1, 1_000, [0, 0], [0, 0], [1_000; 2], [0; 2]),
        root(2, 0, 10, 1, 100 * math::SCALE, 1_000, 0),
    ];
    for (id, account) in roots[..2].iter_mut().enumerate() {
        account.owner = owner;
        account.portfolio = portfolio;
        account.subaccount_index = if id == 0 { 1 } else { 0 };
    }
    let (mut group, mut markets, mut state) = plan(&roots, 0, 7, [1_000; 2], [0; 2]);
    run_with_restarts(&mut roots, &mut group, &mut markets, &mut state, 1);
    assert_eq!(
        roots.iter().map(|root| root.cash).collect::<Vec<_>>(),
        [0, 1_000, 20]
    );
    assert_eq!(state.rows[1].collected, 0);
    assert_eq!(state.rows[2].impaired_scaled, 90 * math::SCALE as u128);
    assert_eq!((group.fees, group.allocated_vault), (7, 1_027));
}

#[test]
fn g12_mixed_sixty_four_members_keep_fraction_ownership_across_every_page_restart() {
    for page_size in 1..=4 {
        // Both registration orders have the same economics but different stable
        // IDs. Tie awards must follow those IDs, never a keeper-chosen page.
        for reverse in [false, true] {
            let mut roots = (0..64)
                .map(|id: u16| {
                    let positive = (id < 32) != reverse;
                    let net_claim = if positive { 500_000_000 } else { -500_000_000 };
                    if id % 4 < 2 {
                        let lots = if id % 4 == 0 { [3, -2] } else { [-3, 2] };
                        cross(
                            id,
                            1,
                            lots,
                            [150 * math::SCALE, -150 * math::SCALE + net_claim],
                            [10_000, 20_000],
                            [17, -19],
                        )
                    } else {
                        let index = usize::from((id / 4) % 2);
                        root(
                            id,
                            index,
                            1,
                            if id % 4 == 2 { 2 } else { -2 },
                            net_claim,
                            [10_000, 20_000][index],
                            [17, -19][index],
                        )
                    }
                })
                .collect::<Vec<_>>();
            let (mut group, mut markets, mut state) =
                plan(&roots, 16, 7, [10_000, 20_000], [17, -19]);
            run_with_restarts(&mut roots, &mut group, &mut markets, &mut state, page_size);
            for (id, (account, row)) in roots.iter().zip(&state.rows).enumerate() {
                let positive = (id < 32) != reverse;
                let paid = if reverse {
                    (32..48).contains(&id)
                } else {
                    id < 16
                };
                assert_eq!(account.cash, if paid { 2 } else { 1 });
                assert_eq!(row.paid, u64::from(paid));
                assert_eq!(row.collected, 0);
                assert_eq!(row.impaired_scaled, 0);
                assert_eq!(row.insured_scaled, if positive { 0 } else { 500_000_000 });
                assert_eq!(
                    row.rounding_scaled,
                    if paid {
                        500_000_000
                    } else if positive {
                        -500_000_000
                    } else {
                        0
                    }
                );
                assert!(account
                    .positions
                    .iter()
                    .all(|position| position.lots == 0 && position.virtual_scaled == 0));
            }
            assert_eq!(
                (
                    group.total_cash,
                    group.insurance,
                    group.fees,
                    group.settlement,
                    group.allocated_vault
                ),
                (80, 0, 7, 0, 87)
            );
            assert_eq!(state.header.rounding_sum, 0);
        }
    }
}

#[test]
fn both_market_derived_claims_fit_the_complete_group_allocator_bound() {
    let mut roots = (0..64)
        .map(|id| {
            let sign = if id < 32 { 1 } else { -1 };
            let mut account = cross(
                id,
                0,
                [0; 2],
                [sign * math::MAX_SCALED; 2],
                [math::MAX_PRICE; 2],
                [0; 2],
            );
            for position in &mut account.positions {
                position.lots = sign as i64 * math::MAX_LOTS;
                position.funding_checkpoint_scaled = math::MAX_FUNDING;
            }
            account
        })
        .collect::<Vec<_>>();
    let (mut group, mut markets, mut state) =
        plan(&roots, 0, 0, [math::MAX_PRICE; 2], [-math::MAX_FUNDING; 2]);
    assert!(model(&roots[0])
        .unwrap()
        .accrued([-math::MAX_FUNDING; 2])
        .is_err());
    run_with_restarts(&mut roots, &mut group, &mut markets, &mut state, 4);
    let per_root = 200_600_000_000_000_000_000_000_000;
    assert_eq!(state.header.positive, 32 * per_root);
    assert_eq!(state.header.debt, 32 * per_root);
    assert!(state.header.positive < (1u128 << 96) / 3);
    for row in &state.rows[..32] {
        assert_eq!(row.impaired_scaled, per_root);
    }
    assert_eq!(group.total_cash, 0);
}

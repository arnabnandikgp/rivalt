use financial_core::{
    margin::{self, Margin, Mode, Position, Risk},
    *,
};
fn root(id: u16, market: usize, cash: u64) -> Margin {
    Margin {
        id,
        mode: Mode::Isolated(market),
        cash,
        positions: [Position::default(); 2],
        reserved: 0,
    }
}
fn risks(price: u64) -> [Risk; 2] {
    [Risk {
        lower: price,
        upper: price,
        funding: 0,
    }; 2]
}

#[test]
fn funded_claim_payments_preserve_fractional_ownership() {
    let mut debtor = root(0, 0, 10);
    debtor.positions[0].virtual_scaled = -2_500_000_001;
    let mut winner = root(1, 1, 10);
    winner.positions[1].virtual_scaled = 2_500_000_001;
    let pools = Pools {
        vault: 20,
        settlement: 0,
        insurance: 0,
        fees: 0,
    };
    margin::reconcile(&[debtor, winner], pools, [100; 2], [0; 2]).unwrap();
    let (debtor, pools) = debtor
        .settle_claim(pools, 0, 2, [100; 2], risks(100), false)
        .unwrap();
    assert_eq!(
        (
            debtor.cash,
            debtor.positions[0].virtual_scaled,
            pools.settlement
        ),
        (8, -500_000_001, 2)
    );
    let (winner, pools) = winner
        .settle_claim(pools, 1, 2, [100; 2], risks(100), true)
        .unwrap();
    assert_eq!(
        (
            winner.cash,
            winner.positions[1].virtual_scaled,
            pools.settlement
        ),
        (12, 500_000_001, 0)
    );
    assert!(debtor
        .settle_claim(pools, 0, 1, [100; 2], risks(100), false)
        .is_err());
    assert!(winner
        .settle_claim(pools, 1, 1, [100; 2], risks(100), true)
        .is_err());
    margin::reconcile(&[debtor, winner], pools, [100; 2], [0; 2]).unwrap();
    assert_eq!(debtor.withdraw(8, risks(100)), Err(Error::Health));
    assert_eq!(debtor.withdraw(7, risks(100)).unwrap().cash, 1);
}

#[test]
fn liquidation_rejects_progress_consumed_by_fee() {
    let mut target = root(0, 0, 4_999);
    target.positions[0] = Position {
        lots: 100,
        virtual_scaled: -100_000 * SCALE,
        generation: 1,
        ..Default::default()
    };
    let receiver = root(1, 0, 20_000);
    assert_eq!(target.deficit(risks(1_000)).unwrap(), SCALE);
    // One lot at 951 releases 50 MM but loses 49 plus the one-atom fee: no progress.
    assert_eq!(
        margin::liquidation_candidate(target, receiver, 0, 1, 951, 1_000, risks(1_000)),
        Err(Error::Health)
    );
    let (target, receiver, fee) =
        margin::liquidation_candidate(target, receiver, 0, 1, 952, 1_000, risks(1_000)).unwrap();
    assert_eq!(
        (
            fee,
            target.cash,
            receiver.cash,
            target.positions[0].lots,
            receiver.positions[0].lots
        ),
        (1, 4_998, 20_001, 99, 1)
    );
    assert_eq!(
        (
            target.positions[0].virtual_scaled,
            receiver.positions[0].virtual_scaled
        ),
        (-99_048 * SCALE, -952 * SCALE)
    );
    assert_eq!(target.deficit(risks(1_000)).unwrap(), 0);
    receiver.admissible(risks(1_000)).unwrap();
}

#[test]
fn liquidation_fee_is_funded_capped_and_never_duplicate_taker_fee() {
    let mut target = root(0, 1, 10_000);
    target.positions[1] = Position {
        lots: -1_000,
        virtual_scaled: 10_000_000 * SCALE,
        generation: 4,
        ..Default::default()
    };
    let receiver = root(1, 1, 20_000_000);
    let (target, receiver, fee) =
        margin::liquidation_candidate(target, receiver, 1, 1_000, 10_000, 10_000, risks(10_000))
            .unwrap();
    assert_eq!(
        (fee, target.cash, receiver.cash),
        (5_000, 5_000, 20_005_000)
    );
    assert_eq!(
        (target.positions[1].lots, target.positions[1].generation),
        (0, 5)
    );
    assert_eq!(target.positions[0], Position::default());
    let mut target = root(0, 0, 9);
    target.positions[0] = Position {
        lots: 4_608,
        virtual_scaled: -460_800_000 * SCALE,
        ..Default::default()
    };
    let (_, _, fee) = margin::liquidation_candidate(
        target,
        root(1, 0, 100_000_000),
        0,
        4_608,
        100_000,
        100_000,
        risks(100_000),
    )
    .unwrap();
    assert_eq!(fee, 9);
    target.cash = 20_000;
    assert_eq!(
        margin::liquidation_candidate(
            target,
            root(1, 0, 100_000_000),
            0,
            4_608,
            100_000,
            100_000,
            risks(100_000)
        )
        .unwrap()
        .2,
        10_000
    );
}

#[test]
fn whole_root_equity_does_not_net_positive_open_claims() {
    let mut account = root(0, 0, 10);
    account.mode = Mode::Cross;
    account.positions[0].virtual_scaled = 30 * SCALE;
    account.positions[1].virtual_scaled = -20 * SCALE;
    assert_eq!(account.risk_equity(risks(100)).unwrap(), -10 * SCALE);
    assert_eq!(account.net_equity([100; 2], [0; 2]).unwrap(), 20 * SCALE);
    assert_eq!(account.withdraw(1, risks(100)), Err(Error::Health));
    account.positions[0].lots = 1;
    account.positions[1].lots = -1;
    let risk = [
        Risk {
            lower: 100,
            upper: 100,
            funding: 3 * SCALE,
        },
        Risk {
            lower: 100,
            upper: 100,
            funding: -2 * SCALE,
        },
    ];
    assert_eq!(
        account
            .accrued(risk.map(|risk| risk.funding))
            .unwrap()
            .positions
            .map(|position| position.virtual_scaled),
        [27 * SCALE, -22 * SCALE]
    );
    assert_eq!(account.requirement(risk, IM_BPS).unwrap(), 20);
}

#[test]
fn exits_include_remaining_reserve_and_pending_fraction() {
    let mut account = root(0, 1, 110);
    account.positions[1] = Position {
        lots: 10,
        virtual_scaled: -1_000 * SCALE,
        ..Default::default()
    };
    account.reserved = 5;
    let mut risk = risks(100);
    risk[1].funding = 1;
    assert_eq!(account.withdraw(5, risk), Err(Error::Health));
    let next = account.withdraw(4, risk).unwrap();
    assert_eq!(
        (next.cash, next.positions[1].virtual_scaled, next.reserved),
        (106, -1_000 * SCALE - 10, 5)
    );
    assert_eq!(next.positions[0], Position::default());
}

#[test]
fn complete_group_reconciliation_rejects_subset_alias_and_hidden_market() {
    let mut first = root(0, 0, 5);
    let mut second = root(1, 1, 5);
    first.positions[0].virtual_scaled = -SCALE;
    second.positions[1].virtual_scaled = SCALE;
    let pools = Pools {
        vault: 10,
        settlement: 0,
        insurance: 0,
        fees: 0,
    };
    margin::reconcile(&[first, second], pools, [100; 2], [17, -19]).unwrap();
    assert!(margin::reconcile(&[first], pools, [100; 2], [17, -19]).is_err());
    assert!(margin::reconcile(&[first, first], pools, [100; 2], [17, -19]).is_err());
    second.positions[0].virtual_scaled = 1;
    assert!(margin::reconcile(&[first, second], pools, [100; 2], [17, -19]).is_err());
}

#[test]
fn two_market_maximum_derived_claims_fit_apportionment_bound() {
    let derived = MAX_SCALED
        + i128::from(MAX_LOTS) * i128::from(MAX_PRICE) * SCALE
        + i128::from(MAX_LOTS) * 2 * MAX_FUNDING;
    assert_eq!(derived, 100_300_000_000_000_000_000_000_000);
    let group_bound = derived as u128 * 2 * 64;
    assert!(group_bound < (1u128 << 96) / 3);
    assert_eq!(
        mul_div_rem(group_bound, group_bound, group_bound).unwrap(),
        (group_bound, 0)
    );
    assert_eq!(mul_div_rem(1, 1, (1u128 << 96) / 3 + 1), Err(Error::Bounds));
}

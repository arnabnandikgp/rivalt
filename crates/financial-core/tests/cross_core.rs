use financial_core::{
    margin::{self, Margin, Mode, Position, Risk},
    *,
};

fn cross(id: u16, cash: u64) -> Margin {
    Margin {
        id,
        cash,
        mode: Mode::Cross,
        positions: [Position::default(); 2],
        reserved: 0,
    }
}
fn risks(funding: [i128; 2]) -> [Risk; 2] {
    funding.map(|funding| Risk {
        lower: 100,
        upper: 100,
        funding,
    })
}

#[test]
fn g01_cash_is_counted_once_and_positive_open_profit_has_no_credit() {
    let mut account = cross(0, 1_000);
    account.positions[0].lots = 1;
    account.positions[0].virtual_scaled = 200 * SCALE;
    account.positions[1].lots = 1;
    account.positions[1].virtual_scaled = -300 * SCALE;
    assert_eq!(
        account.claims([100; 2], [0; 2]).unwrap(),
        [300 * SCALE, -200 * SCALE]
    );
    assert_eq!(account.risk_equity(risks([0; 2])).unwrap(), 800 * SCALE);
    assert_eq!(account.net_equity([100; 2], [0; 2]).unwrap(), 1_100 * SCALE);
    assert_eq!(account.requirement(risks([0; 2]), IM_BPS).unwrap(), 20);
    assert_eq!(account.requirement(risks([0; 2]), MM_BPS).unwrap(), 10);
}

#[test]
fn g02_btc_fill_and_withdrawal_pay_pending_eth_funding() {
    let mut trader = cross(0, 1_000);
    for (index, lots) in [1, 2].into_iter().enumerate() {
        trader.positions[index].lots = lots;
        trader.positions[index].virtual_scaled = -i128::from(lots) * 100 * SCALE;
    }
    let funding = [0, 5 * SCALE];
    assert_eq!(trader.withdraw(961, risks(funding)), Err(Error::Health));
    let withdrawn = trader.withdraw(960, risks(funding)).unwrap();
    assert_eq!(withdrawn.cash, 40);
    assert_eq!(withdrawn.risk_equity(risks(funding)).unwrap(), 30 * SCALE);
    let mut maker = cross(1, 1_000);
    maker.mode = Mode::Isolated(0);
    let (filled, providers, fee) =
        margin::route_candidate(trader, &[maker], 0, &[(10, 1_000)], 0, funding, 0).unwrap();
    assert_eq!((filled.cash, fee, providers[0].cash), (999, 1, 1_000));
    assert_eq!(filled.positions[0].lots, 11);
    assert_eq!(filled.positions[1].virtual_scaled, -210 * SCALE);
    assert_eq!(filled.positions[1].funding_checkpoint, 5 * SCALE);
    assert_eq!(filled.risk_equity(risks(funding)).unwrap(), 989 * SCALE);
}

#[test]
fn g03_transfer_cannot_spend_remaining_reservations_or_duplicate_cash() {
    let mut donor = cross(0, 1_000);
    donor.positions[0].lots = 50;
    donor.positions[0].virtual_scaled = -5_000 * SCALE;
    donor.reserved = 300;
    let recipient = cross(1, 100);
    assert_eq!(
        margin::transfer_candidate(donor, recipient, 250, risks([0; 2])),
        Err(Error::Health)
    );
    let (after, received) =
        margin::transfer_candidate(donor, recipient, 200, risks([0; 2])).unwrap();
    assert_eq!((after.cash, received.cash), (800, 300));
    assert_eq!(after.cash + received.cash, donor.cash + recipient.cash);
    assert_eq!(after.positions, donor.positions);
    assert_eq!(
        margin::transfer_candidate(donor, donor, 1, risks([0; 2])),
        Err(Error::Invariant)
    );
}

#[test]
fn g04_flat_netting_preserves_fractions_and_never_creates_cash() {
    let mut account = cross(0, 1_000);
    account.positions[0].virtual_scaled = 300 * SCALE;
    account.positions[1].virtual_scaled = -200 * SCALE;
    let netted = account.net_closed_claims([7, 11]).unwrap();
    assert_eq!(netted.cash, 1_000);
    assert_eq!(
        netted.positions.map(|position| position.virtual_scaled),
        [100 * SCALE, 0]
    );
    assert_eq!(
        netted.positions.map(|position| position.funding_checkpoint),
        [7, 11]
    );
    account.positions[0].virtual_scaled = 3 * SCALE + 1;
    account.positions[1].virtual_scaled = -(2 * SCALE + 2);
    let netted = account.net_closed_claims([0; 2]).unwrap();
    assert_eq!(
        netted.positions.map(|position| position.virtual_scaled),
        [SCALE - 1, 0]
    );
    let mut maker = cross(1, 1_000);
    maker.mode = Mode::Isolated(0);
    let (reopened, _, _) =
        margin::route_candidate(netted, &[maker], 0, &[(10, 1_000)], 0, [0; 2], 0).unwrap();
    assert_eq!(reopened.claims([100; 2], [0; 2]).unwrap(), [SCALE - 1, 0]);
    assert_eq!(reopened.positions[0].generation, 1);
}

#[test]
fn closed_netting_rejects_live_slots_reserves_isolated_mode_and_no_op() {
    let mut account = cross(0, 1_000);
    assert_eq!(account.net_closed_claims([0; 2]), Err(Error::Bounds));
    account.positions[0].virtual_scaled = -3 * SCALE;
    account.positions[1].virtual_scaled = 2 * SCALE;
    assert_eq!(
        account
            .net_closed_claims([0; 2])
            .unwrap()
            .positions
            .map(|position| position.virtual_scaled),
        [-SCALE, 0]
    );
    for market in 0..2 {
        let mut live = account;
        live.positions[market].lots = 1;
        assert_eq!(live.net_closed_claims([0; 2]), Err(Error::Bounds));
    }
    account.reserved = 1;
    assert_eq!(account.net_closed_claims([0; 2]), Err(Error::Bounds));
    let mut isolated = cross(0, 100);
    isolated.mode = Mode::Isolated(0);
    assert_eq!(isolated.net_closed_claims([0; 2]), Err(Error::Bounds));
}

#[test]
fn g09_divided_funding_retains_three_tenths_and_account_ownership() {
    let mut account = cross(0, 1_000);
    account.positions[0].lots = 3;
    account.positions[1].lots = -3;
    let complete = account.accrued([SCALE / 10; 2]).unwrap();
    let divided = account
        .accrued([SCALE / 25; 2])
        .unwrap()
        .accrued([SCALE / 10; 2])
        .unwrap();
    assert_eq!(complete, divided);
    assert_eq!(
        complete.positions.map(|position| position.virtual_scaled),
        [-300_000_000, 300_000_000]
    );
    assert_eq!(complete.cash, 1_000);
    let recipient = cross(1, 100);
    let (donor, recipient) =
        margin::transfer_candidate(complete, recipient, 100, risks([SCALE / 10; 2])).unwrap();
    assert_eq!(donor.positions, complete.positions);
    assert_eq!(
        recipient.positions.map(|position| position.virtual_scaled),
        [0, 0]
    );
    assert_eq!((donor.cash, recipient.cash), (900, 200));
}

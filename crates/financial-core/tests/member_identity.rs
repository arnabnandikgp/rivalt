//! Literal financial cases at sparse full-width IDs. Population bounds belong to
//! complete-cohort algorithms, not to a root's identity or a two-maker trade.
use financial_core::{
    margin::{self, Margin, Mode, Position, Risk},
    *,
};
fn root(id: u64, mode: Mode) -> Margin {
    Margin {
        id,
        mode,
        cash: 1_000,
        positions: [Position::default(); 2],
        reserved: 0,
    }
}
#[test]
fn full_width_identity_does_not_change_cash_funding_fees_or_self_trade_checks() {
    for id in [64, 65_536, 1u64 << 53, u64::MAX - 1] {
        let trader = root(id, Mode::Cross);
        let maker = root(id + 1, Mode::Isolated(0));
        let (filled, providers, fee) =
            margin::route_candidate(trader, &[maker], 0, &[(10, 1_000)], 0, [0; 2], 0).unwrap();
        assert_eq!((filled.id, providers[0].id), (id, id + 1));
        assert_eq!((filled.cash, providers[0].cash, fee), (999, 1_000, 1));
        assert_eq!(
            (filled.positions[0].lots, filled.positions[0].virtual_scaled),
            (10, -1_000 * SCALE)
        );
        assert_eq!(
            (
                providers[0].positions[0].lots,
                providers[0].positions[0].virtual_scaled
            ),
            (-10, 1_000 * SCALE)
        );
        let risks = [Risk {
            lower: 100,
            upper: 100,
            funding: SCALE / 2,
        }; 2];
        // Ten long lots owe five atoms; IM is 100. Positive other-market profit
        // never supplies credit. Withdrawing 895 leaves 104 against required 105.
        assert_eq!(filled.withdraw(895, risks), Err(Error::Health));
        let after = filled.withdraw(894, risks).unwrap();
        assert_eq!(
            (after.cash, after.positions[0].virtual_scaled),
            (105, -1_005 * SCALE)
        );
        assert_eq!(after.risk_equity(risks).unwrap(), 100 * SCALE);
        assert!(margin::route_candidate(
            trader,
            &[Margin { id, ..maker }],
            0,
            &[(10, 1_000)],
            0,
            [0; 2],
            0
        )
        .is_err());
        assert!(margin::transfer_candidate(trader, trader, 1, risks).is_err());
        let (_, recipient) = margin::transfer_candidate(
            root(id, Mode::Cross),
            root(id + 1, Mode::Cross),
            123,
            risks,
        )
        .unwrap();
        assert_eq!((recipient.id, recipient.cash), (id + 1, 1_123));
    }
}
#[test]
fn retained_small_cohort_apportionment_uses_stable_u64_tie_breaks() {
    let high = 1u64 << 53;
    assert_eq!(apportion(1, &[(high + 1, 1), (high, 1)]).unwrap(), [0, 1]);
    assert!(apportion(1, &[(high, 1), (high, 1)]).is_err());
    // This retained reference remains bounded in population, independently of IDs.
    let rows: Vec<_> = (0..65).map(|index| (index as u64, 1)).collect();
    assert!(apportion(1, &rows).is_err());
}

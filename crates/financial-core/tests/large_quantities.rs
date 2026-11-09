use financial_core::{
    margin::{self, Margin, Mode, Position, Risk},
    orders, Error, MAX_CASH, MAX_LOTS, SCALE,
};

#[test]
fn large_order_reserves_keep_exact_loss_margin_and_signed_fee_budget() {
    // 1m*(60,600/10 + 60,000-59,400) + 12m fee atoms.
    assert_eq!(
        orders::reserve(1_000_000, 60_000, 12_000_000, 0, false, 59_400, 60_600),
        Ok(6_672_000_000)
    );
    assert_eq!(
        orders::reserve(1_000_000, 60_000, 12_000_000, 0, true, 59_400, 60_600),
        Ok(612_000_000)
    );
    assert_eq!(
        orders::reserve(MAX_LOTS as u64, 60_000, 0, 0, false, 59_400, 60_600),
        Ok(666_000_000_000)
    );
    assert_eq!(
        orders::reserve(MAX_LOTS as u64 + 1, 60_000, 0, 0, false, 59_400, 60_600),
        Err(Error::Bounds)
    );
    assert_eq!(
        orders::reserve(1, 60_000, MAX_CASH + 1, 0, false, 59_400, 60_600),
        Err(Error::Bounds)
    );
}

#[test]
fn half_million_lot_liquidation_preserves_fraction_and_progress_after_fee() {
    let mut target = Margin {
        id: 0,
        mode: Mode::Isolated(0),
        cash: 100_000_000,
        positions: [Position::default(); 2],
        reserved: 0,
    };
    target.positions[0] = Position {
        lots: 1_000_000,
        virtual_scaled: -10_000_000_000 * SCALE - 1,
        generation: 1,
        ..Position::default()
    };
    let receiver = Margin {
        id: 1,
        mode: Mode::Isolated(0),
        cash: 10_000_000_000,
        positions: [Position::default(); 2],
        reserved: 0,
    };
    let risks = [Risk {
        lower: 10_000,
        upper: 10_000,
        funding: 0,
    }; 2];
    assert_eq!(target.deficit(risks).unwrap(), 400_000_000 * SCALE + 1);
    let (next, received, fee) =
        margin::liquidation_candidate(target, receiver, 0, 500_000, 10_000, 10_000, risks).unwrap();
    assert_eq!(fee, 10_000);
    assert_eq!((next.cash, received.cash), (99_990_000, 10_000_010_000));
    assert_eq!(
        (next.positions[0].lots, received.positions[0].lots),
        (500_000, 500_000)
    );
    assert_eq!(next.positions[0].virtual_scaled, -5_000_000_000 * SCALE - 1);
    assert_eq!(received.positions[0].virtual_scaled, -5_000_000_000 * SCALE);
    assert_eq!(next.deficit(risks).unwrap(), 150_010_000 * SCALE + 1);
    received.admissible(risks).unwrap();
    assert!(
        margin::liquidation_candidate(target, receiver, 0, 1_000_001, 10_000, 10_000, risks)
            .is_err()
    );
}

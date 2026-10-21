use financial_core::{
    liquidation::{candidate, deficit},
    Error, Participant, SCALE,
};
fn target(short: bool) -> Participant {
    Participant {
        id: 0,
        cash: 20000,
        lots: if short { -10 } else { 10 },
        virtual_scaled: (if short { 600000 } else { -600000 }) * SCALE,
        generation: 1,
        ..Participant::default()
    }
}
fn receiver(cash: u64) -> Participant {
    Participant {
        id: 1,
        cash,
        ..Participant::default()
    }
}
#[test]
fn literal_long_and_short_progress_and_funded_fee() {
    let p = target(false);
    assert_eq!(deficit(&p, 57420, 58580, 0).unwrap(), 35090 * SCALE);
    let (t, r, fee) = candidate(p, receiver(100000), 4, 58000, 58000, 57420, 58580, 0).unwrap();
    assert_eq!(
        (t.cash, t.lots, t.virtual_scaled, fee),
        (19884, 6, -368000 * SCALE, 116)
    );
    assert_eq!(
        (r.cash, r.lots, r.virtual_scaled),
        (100116, 4, -232000 * SCALE)
    );
    assert_eq!(deficit(&t, 57420, 58580, 0).unwrap(), 21170 * SCALE);
    r.admissible(57420, 58580, 0).unwrap();
    let p = target(true);
    assert_eq!(deficit(&p, 61380, 62620, 0).unwrap(), 37510 * SCALE);
    let (t, r, fee) = candidate(p, receiver(100000), 4, 62000, 62000, 61380, 62620, 0).unwrap();
    assert_eq!(
        (t.cash, t.lots, t.virtual_scaled, fee),
        (19876, -6, 352000 * SCALE, 124)
    );
    assert_eq!(
        (r.cash, r.lots, r.virtual_scaled),
        (100124, -4, 248000 * SCALE)
    );
    assert_eq!(deficit(&t, 61380, 62620, 0).unwrap(), 22630 * SCALE);
    r.admissible(61380, 62620, 0).unwrap();
}
#[test]
fn bad_price_progress_and_receiver_capacity_fail_independently() {
    assert_eq!(
        candidate(
            target(false),
            receiver(100000),
            4,
            52200,
            58000,
            57420,
            58580,
            0
        ),
        Err(Error::Health)
    );
    assert_eq!(
        candidate(
            target(false),
            receiver(100000),
            4,
            52199,
            58000,
            57420,
            58580,
            0
        ),
        Err(Error::Bounds)
    );
    let (_, r, _) = candidate(
        target(false),
        receiver(100),
        4,
        58000,
        58000,
        57420,
        58580,
        0,
    )
    .unwrap();
    assert_eq!(r.admissible(57420, 58580, 0), Err(Error::Health));
    let mut healthy = target(false);
    healthy.cash = 100000;
    healthy.reserved = 900000;
    assert_eq!(
        candidate(healthy, receiver(100000), 4, 58000, 58000, 57420, 58580, 0),
        Err(Error::Health)
    );
    assert_eq!(
        candidate(
            target(false),
            target(false),
            1,
            58000,
            58000,
            57420,
            58580,
            0
        ),
        Err(Error::Bounds)
    );
    assert_eq!(
        candidate(
            target(false),
            receiver(100000),
            11,
            58000,
            58000,
            57420,
            58580,
            0
        ),
        Err(Error::Bounds)
    );
}
#[test]
fn fee_never_exceeds_funded_cash_or_absolute_cap() {
    let mut p = target(false);
    p.cash = 7;
    let (t, r, fee) = candidate(p, receiver(100000), 4, 58000, 58000, 57420, 58580, 0).unwrap();
    assert_eq!((t.cash, r.cash, fee), (0, 100007, 7));
    p.cash = 10_000_000;
    p.lots = 4000;
    p.virtual_scaled = -240_000_000 * SCALE;
    let (t, r, fee) = candidate(
        p,
        receiver(1_000_000_000),
        4000,
        50000,
        50000,
        49500,
        50500,
        0,
    )
    .unwrap();
    assert_eq!(
        (t.lots, t.generation, t.cash, fee),
        (0, 2, 9_990_000, 10000)
    );
    assert_eq!(r.cash, 1_000_010_000);
    r.admissible(49500, 50500, 0).unwrap();
}
#[test]
fn independent_integer_grid_matches_post_fee_progress() {
    for short in [false, true] {
        let p = target(short);
        let sign = if short { -1i128 } else { 1 };
        let reference = if short { 62000u64 } else { 58000 };
        let lower = reference * 99 / 100;
        let upper = reference * 101 / 100;
        let d = |cash: u64, q: i128, v: i128| {
            let mark = if q < 0 { upper } else { lower };
            let equity = i128::from(cash) * SCALE + (v + q * i128::from(mark) * SCALE).min(0);
            let mm = (q.abs() * i128::from(upper) * 500 + 9999) / 10000;
            (mm * SCALE - equity).max(0)
        };
        let before = d(p.cash, i128::from(p.lots), p.virtual_scaled);
        for lots in 1..=10u64 {
            for price in (reference * 9 / 10..=reference * 11 / 10).step_by(137) {
                let gross = lots * price;
                let fee = ((gross + 1999) / 2000).min(10000).min(p.cash);
                let cash = p.cash - fee;
                let q = i128::from(p.lots) - sign * i128::from(lots);
                let v = p.virtual_scaled + sign * i128::from(gross) * SCALE;
                let actual = candidate(
                    p,
                    receiver(100_000_000),
                    lots,
                    price,
                    reference,
                    lower,
                    upper,
                    0,
                );
                if d(cash, q, v) >= before {
                    assert_eq!(actual, Err(Error::Health));
                } else {
                    let (t, r, f) = actual.unwrap();
                    assert_eq!(
                        (t.cash, i128::from(t.lots), t.virtual_scaled, f),
                        (cash, q, v, fee)
                    );
                    assert_eq!(t.cash + r.cash, p.cash + 100_000_000);
                    assert_eq!(t.lots + r.lots, p.lots);
                    assert_eq!(t.virtual_scaled + r.virtual_scaled, p.virtual_scaled);
                    r.admissible(lower, upper, 0).unwrap();
                }
            }
        }
    }
}

use financial_core::{orders::reserve, route, Participant, SCALE};

#[test]
fn literal_reserves_and_fee_prefix_are_not_proportional() {
    // 6060 IM + 1600 execution-loss per lot, plus lifetime fee authorization.
    assert_eq!(
        reserve(10, 61000, 200, 0, false, 59400, 60600).unwrap(),
        76800
    );
    assert_eq!(
        reserve(6, 61000, 151, 0, false, 59400, 60600).unwrap(),
        46111
    );
    assert_ne!(46111, 76800 * 6 / 10);
    assert_eq!(reserve(6, 59000, 151, 1, true, 59400, 60600).unwrap(), 9751);
    assert_eq!(reserve(0, 59000, 151, 1, true, 59400, 60600).unwrap(), 0);
    let p = |id| Participant {
        id,
        cash: 1_000_000,
        ..Participant::default()
    };
    let (t, m, fee) = route::candidate(p(0), &[p(1)], &[(1, 60018)], 0, 0, 0).unwrap();
    assert_eq!(
        (t.cash, fee, t.virtual_scaled),
        (999987, 13, -60018 * SCALE)
    );
    let (t, _, fee) = route::candidate(t, &m, &[(1, 60018)], 0, 0, 60018).unwrap();
    assert_eq!(
        (t.cash, fee, t.virtual_scaled),
        (999975, 12, -120036 * SCALE)
    );
}

#[test]
fn reserve_covers_independently_enumerated_partial_post_states() {
    // Independent exact integer economic transitions, deliberately fractional
    // upper/10 and asymmetric prices. Every legal partition retains headroom.
    for side in [0, 1] {
        for upper in [10001u64, 60603, 100007] {
            let lower = upper * 97 / 100;
            let limit = if side == 0 { upper + 17 } else { lower - 13 };
            for total in 1..=32u64 {
                for filled in 0..=total {
                    let reserved = reserve(total, limit, 999, side, false, lower, upper).unwrap();
                    let remain =
                        reserve(total - filled, limit, 999, side, false, lower, upper).unwrap();
                    let loss = filled
                        * (if side == 0 {
                            limit - lower
                        } else {
                            upper - limit
                        });
                    let im = (filled * upper + 9) / 10;
                    assert!(reserved >= remain + loss + im);
                }
            }
        }
    }
}

use financial_core::{oracle::*, Participant, SCALE};
fn btc(value: i64, published: i64) -> Price {
    Price {
        value,
        confidence: 0,
        exponent: -6,
        published,
    }
}
fn usd(value: i64, published: i64) -> Price {
    btc(value, published)
}
#[test]
fn source_profile_and_conversion() {
    let p = [btc(60_000_000_000, 100), usd(1_000_000, 100)];
    assert_eq!(
        bounds(p, Some(p), 100).unwrap(),
        Bounds {
            reference: 60_000,
            lower: 59_400,
            upper: 60_600,
            normal: true,
            deadline: 120
        }
    );
    assert!(!valid(
        Price {
            exponent: -8,
            ..p[0]
        },
        100,
        false
    ));
    assert!(!valid(Price { value: 0, ..p[0] }, 100, false));
    assert!(!valid(
        Price {
            confidence: 300_000_001,
            ..p[0]
        },
        100,
        false
    ));
    assert!(!valid(p[0], 121, false));
    assert!(!valid(p[0], 97, false));
    assert!(valid(p[0], 98, false));
    assert!(!bounds(p, None, 100).unwrap().normal);
    assert!(bounds(p, Some([btc(61_000_000_000, 100), p[1]]), 100).is_err());
    let shock = [p[0], usd(900_000, 100)];
    let b = bounds(shock, Some(shock), 100).unwrap();
    assert_eq!((b.reference, b.normal), (66_666, false));
    assert!(b.lower <= 66_666 && b.upper >= 66_667);
}
#[test]
fn exact_cap_prefix_and_no_retroactive_rate() {
    // Midpoint 60,010: 100-lot aggregate quote sum 12,002,000.
    let p = premium(60_000, 100, 5_999_000, 6_003_000).unwrap();
    assert_eq!(p, 10 * SCALE);
    assert_eq!(endpoint(0, p, 100, 106, 103).unwrap(), 8_333_333);
    assert_eq!(endpoint(0, p, 100, 106, 106).unwrap(), 16_666_666);
    assert_eq!(endpoint(0, p, 100, 106, 999).unwrap(), 16_666_666);
    assert!(endpoint(0, p, 100, 107, 103).is_err());
    assert!(endpoint(0, p, 100, 106, 99).is_err());
    assert_eq!(
        premium(60_000, 100, 6_090_000, 6_110_000).unwrap(),
        300 * SCALE
    );
    assert_eq!(
        premium(60_000, 100, 5_890_000, 5_910_000).unwrap(),
        -300 * SCALE
    );
    // A new opposite rate starts at the old endpoint; it does not change elapsed time.
    assert_eq!(endpoint(16_666_666, -p, 110, 116, 113).unwrap(), 8_333_333);
}
#[test]
fn turnover_and_flat_reopening_keep_participant_fraction() {
    let long = Participant {
        id: 0,
        lots: 3,
        cash: 1_000_000,
        ..Participant::default()
    };
    let short = Participant {
        id: 1,
        lots: -3,
        cash: 1_000_000,
        ..Participant::default()
    };
    let x = long.accrued(100_000_000).unwrap();
    let y = short.accrued(100_000_000).unwrap();
    assert_eq!(
        (x.virtual_scaled, y.virtual_scaled),
        (-300_000_000, 300_000_000)
    );
    let flat = x.with_lots(0).unwrap().accrued(200_000_000).unwrap();
    assert_eq!(flat.virtual_scaled, -300_000_000);
    let reopened = flat.with_lots(3).unwrap().accrued(300_000_000).unwrap();
    assert_eq!(reopened.virtual_scaled, -600_000_000);
    let entrant = Participant {
        id: 2,
        ..Participant::default()
    }
    .accrued(200_000_000)
    .unwrap()
    .with_lots(3)
    .unwrap()
    .accrued(300_000_000)
    .unwrap();
    assert_eq!(entrant.virtual_scaled, -300_000_000);
    // Independent integer identity over many positive/negative prefixes.
    for q in -25..=25 {
        for f in -17..=17 {
            let p = Participant {
                lots: q,
                ..Participant::default()
            };
            let f = f * 1_234_567;
            assert_eq!(
                p.accrued(f).unwrap().accrued(f * 2).unwrap().virtual_scaled,
                -i128::from(q) * f * 2
            );
        }
    }
}

#[test]
fn extreme_endpoint_inputs_reject_without_panicking() {
    assert!(endpoint(i128::MIN, 0, 100, 106, 103).is_err());
    assert!(endpoint(0, i128::MIN, 100, 106, 103).is_err());
    assert!(endpoint(0, 0, i64::MIN, i64::MAX, 100).is_err());
}

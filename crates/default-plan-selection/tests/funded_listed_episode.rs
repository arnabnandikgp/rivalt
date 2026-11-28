//! Proposed default workload from the signed cash-access book. Only the shock is hypothetical.
#![cfg(feature = "indexed-settlement")]
use default_plan_selection::market_indexed::{verify_book, Cell, Member, RatesProof};

#[test]
fn btc_and_eth_creditors_share_the_cross_debt_after_a_sol_gain() {
    // One BTC long at 60,002, ten ETH shorts at 29,998 and ten SOL longs at 152.
    // Settlement indices 53,002 / 33,498 / 332 leave a 26-atom deficit.
    let funded = [
        1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 40_174, 1_000_000, 0,
        100_000, 100_000, 100_000,
    ];
    let mut members = funded.map(|cash| Member {
        cash,
        cells: vec![Cell::default(); 3],
    });
    for (member, market, lots, claim) in [
        (0, 0, -1, 7_000),
        (3, 1, 10, 35_000),
        (6, 0, 1, -7_000),
        (6, 1, -10, -35_000),
        (6, 2, 10, 1_800),
        (9, 2, -10, -1_800),
    ] {
        members[member].cells[market] = Cell {
            claim,
            lots,
            eligible: claim.max(0) as u32,
        };
    }
    // Independent exact fractions from tests/financial/indexed_default_certificate.py.
    // Each line is the rate denominator and the BTC, ETH and SOL numerators.
    let proof = RatesProof {
        denominator: 0,
        selected: 13,
        numerators: vec![
            5250, 5249, 5249, 5250, 36744750, 36743000, 36737751, 36744750, 183744750, 183709751,
            183715000, 183744750, 734874003, 734839004, 734755020, 734874003, 91869750, 91852251,
            91857500, 91869750, 122475501, 122469668, 122459170, 122475501, 183734250, 183699253,
            183715000, 183734250, 734832009, 734797012, 734755020, 734832009, 45932250, 45923501,
            45928750, 45932250, 183702753, 183694004, 183688755, 183702753, 36744750, 36737751,
            36743000, 36744750, 20997, 20996, 20996, 20997, 91859250, 91841753, 91857500, 91859250,
            367384509, 367367012, 367377510, 367384509,
        ],
    };
    let result = verify_book(&members, &[0; 3], &[3, 15, 0], &proof, None).unwrap();
    assert_eq!(result.checked_plans, 14);
    assert_eq!(&result.spent[..3], &[3, 15, 0]);
    assert_eq!(&result.charges[..3], &[1, 6, 0]);
    assert_eq!(
        result.cash,
        [
            1_006_999, 1_000_000, 1_000_000, 1_034_993, 1_000_000, 1_000_000, 0, 1_000_000, 0,
            98_200, 100_000, 100_000
        ]
    );
    assert!(verify_book(
        &members,
        &[0; 3],
        &[3, 15, 0],
        &RatesProof {
            selected: 0,
            ..proof
        },
        None
    )
    .is_err());
}

#[test]
fn unframed_rates_must_encode_both_half_atom_debt_payments() {
    // Both cross debtors forward half an atom to each destination. The fourth
    // market has a real unpaid creditor so the terminal settlement is eligible.
    let accounts = [
        (1, [-1, -1, 1, 0]), (1, [-1, -1, 1, 0]), (0, [2, 2, 0, 0]),
        (2, [0, 0, -2, 0]), (0, [0, 0, 0, -1]), (0, [0, 0, 0, 1]),
    ];
    let members = accounts.map(|(cash, claims)| Member {
        cash,
        cells: claims.map(|claim| Cell { claim, ..Cell::default() }).to_vec(),
    });
    let proof = |unit| RatesProof { denominator: unit, selected: 0, numerators: vec![unit, unit, unit, 0] };
    assert!(verify_book(&members, &[0; 4], &[0; 4], &proof(1), None).is_err());
    let settlement = verify_book(&members, &[0; 4], &[0; 4], &proof(2), None).unwrap();
    assert_eq!(settlement.cash, [0, 0, 4, 0, 0, 0]);
}

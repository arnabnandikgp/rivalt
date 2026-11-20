#![cfg(feature = "native-search")]
use clearing_accounting::{attribution::Attribution, Error, SCALE};
use default_plan_selection::multi_lot::{Audit, Book, Member, Verdict};
use num_bigint::BigUint;
use std::num::NonZeroU32;

fn histories() -> [Vec<u8>; 2] {
    [(2, 200), (-2, 208)].map(|(qty, quote)| {
        let mut bytes = vec![0; 32];
        Attribution::default()
            .fill(0, qty, quote)
            .unwrap()
            .write(&mut bytes)
            .unwrap();
        bytes
    })
}

fn book(histories: &[Vec<u8>; 2], epoch: u64, root: &[u8; 32], cash: u64) -> Book {
    Book::from_members(
        &[8; 32],
        epoch,
        root,
        100,
        1,
        &[
            Member {
                id: 11,
                lots: 2,
                face_scaled: -8 * SCALE,
                cash,
                history: &histories[0],
            },
            Member {
                id: 19,
                lots: -2,
                face_scaled: 6 * SCALE,
                cash: 0,
                history: &histories[1],
            },
            Member {
                id: 21,
                lots: 0,
                face_scaled: 2 * SCALE,
                cash: 0,
                history: &[],
            },
        ],
    )
    .unwrap()
}

#[test]
fn only_complete_ranges_release_a_schedule_and_a_restart_binds_every_input() {
    let histories = histories();
    let original = book(&histories, 2, &[0; 32], 3);
    let optimal = vec![4];
    let mut audit = original.begin(optimal.clone()).unwrap();
    assert_eq!(original.candidates(), &BigUint::from(5u8));
    assert!(audit.certified_pairs(&original).is_err());
    assert_eq!(
        audit
            .advance(&original, &0u8.into(), NonZeroU32::new(2).unwrap())
            .unwrap(),
        &Verdict::Pending
    );
    let saved = audit.checkpoint().unwrap();
    assert!(matches!(
        audit.advance(&original, &0u8.into(), NonZeroU32::new(1).unwrap()),
        Err(Error::Generation)
    ));
    assert!(Audit::resume_trusted(&original, vec![3], saved.clone()).is_err());
    for different in [
        book(&histories, 3, &[0; 32], 3),
        book(&histories, 2, &[9; 32], 3),
        book(&histories, 2, &[0; 32], 4),
    ] {
        assert!(Audit::resume_trusted(&different, optimal.clone(), saved.clone()).is_err());
    }
    let mut resumed = Audit::resume_trusted(&original, optimal, saved).unwrap();
    assert_eq!(
        resumed
            .advance(&original, &2u8.into(), NonZeroU32::new(4).unwrap())
            .unwrap(),
        &Verdict::Verified
    );
    let pairs = resumed.certified_pairs(&original).unwrap();
    assert_eq!(
        (
            pairs[0].0,
            pairs[0].1,
            pairs[0].2.charge,
            pairs[0].2.matched
        ),
        (11, 19, 4, 1)
    );
    assert!(resumed.checkpoint().is_err());
    assert!(resumed
        .certified_pairs(&book(&histories, 3, &[0; 32], 3))
        .is_err());
}

#[test]
fn invalid_proposals_and_outscored_prefixes_cannot_expose_fills() {
    let original = book(&histories(), 2, &[0; 32], 3);
    assert!(original.begin(vec![5]).is_err());
    assert!(original.begin(vec![]).is_err());
    let mut wrong = original.begin(vec![2]).unwrap();
    assert_eq!(
        wrong
            .advance(&original, &0u8.into(), NonZeroU32::new(10).unwrap())
            .unwrap(),
        &Verdict::Outscored(3u8.into())
    );
    assert!(wrong.certified_pairs(&original).is_err());
    assert!(wrong.checkpoint().is_err());
}

#[test]
fn unmatched_positions_unbalanced_claims_and_uncanonical_history_are_refused() {
    let attribution = histories();
    let valid = || {
        vec![
            Member {
                id: 1,
                lots: 2,
                face_scaled: -8 * SCALE,
                cash: 3,
                history: &attribution[0],
            },
            Member {
                id: 4,
                lots: -2,
                face_scaled: 8 * SCALE,
                cash: 0,
                history: &attribution[1],
            },
        ]
    };
    let create = |rows: &[Member]| Book::from_members(&[9; 32], 2, &[3; 32], 100, 0, rows);
    for kind in 0..5 {
        let mut rows = valid();
        match kind {
            0 => rows[1].lots = -1,
            1 => rows[1].face_scaled += SCALE,
            2 => rows[1].face_scaled -= 1,
            3 => rows[1].id = rows[0].id,
            _ => rows[1].history = &[0u8; 10],
        }
        assert!(create(&rows).is_err());
    }
}

#[test]
fn a_multi_lot_book_can_certify_without_iterating_over_atom_amounts() {
    let mut short = vec![0; 32];
    let mut long = vec![0; 32];
    Attribution::default()
        .fill(0, -2, 400_000)
        .unwrap()
        .write(&mut short)
        .unwrap();
    Attribution::default()
        .fill(0, 2, 400_000)
        .unwrap()
        .write(&mut long)
        .unwrap();
    let rows: Vec<_> = (0..4)
        .map(|id| {
            if id < 2 {
                Member {
                    id,
                    lots: 2,
                    face_scaled: -200_000 * SCALE,
                    cash: 130_000,
                    history: &long,
                }
            } else {
                Member {
                    id,
                    lots: -2,
                    face_scaled: 200_000 * SCALE,
                    cash: 0,
                    history: &short,
                }
            }
        })
        .collect();
    let book = Book::from_members(&[9; 32], 3, &[1; 32], 100_000, 0, &rows).unwrap();
    // Each of the four edges ranges from zero through 70,000 inclusive.
    assert_eq!(book.candidates(), &BigUint::from(70_001u32).pow(4));
    assert!(book.candidates() > &BigUint::from(u64::MAX));
    // In D121 order the first winner gets its charge from the first debtor.
    assert!(book.verifies_by_bounds(&[70_000, 0, 0, 70_000]).unwrap());
    assert!(!book.verifies_by_bounds(&[0, 70_000, 70_000, 0]).unwrap());
    assert!(!book.verifies_by_bounds(&[35_000; 4]).unwrap());
    assert!(!book.verifies_by_bounds(&[69_999, 0, 0, 70_000]).unwrap());
    let mut unsearched = book.begin(vec![70_000, 0, 0, 70_000]).unwrap();
    assert_eq!(
        unsearched
            .advance(&book, &0u8.into(), NonZeroU32::new(17).unwrap())
            .unwrap(),
        &Verdict::Pending
    );
}

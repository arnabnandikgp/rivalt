use financial_core::clearing::scalable::{atom_division::AtomDivision, normalized::Magnitude};
#[test]
fn persisted_atom_division_binds_scratch_inputs_and_pending_comparison() {
    let cursor = AtomDivision::new(
        Magnitude {
            register: 0,
            used: 2,
        },
        Magnitude {
            register: 1,
            used: 2,
        },
        [2, 3],
        8,
    )
    .unwrap();
    let bytes = cursor.checkpoint();
    assert_eq!(bytes.len(), 384);
    assert_eq!(bytes[0], 1);
    assert_eq!(bytes[5], 1);
    assert_eq!(&bytes[8..16], &8u64.to_le_bytes());
    assert_eq!(&bytes[24..32], &2u64.to_le_bytes());
    assert_eq!(&bytes[40..48], &2u64.to_le_bytes());
    assert_eq!(
        AtomDivision::from_checkpoint(&bytes, 8)
            .unwrap()
            .checkpoint(),
        bytes
    );
    assert!(AtomDivision::from_checkpoint(&bytes, 7).is_err());
    for (index, value) in [
        (0, 2),
        (1, 8),
        (2, 6),
        (3, 3),
        (4, 1),
        (5, 0),
        (6, 1),
        (20, 1),
        (36, 1),
        (60, 1),
        (76, 1),
        (368, 1),
        (383, 1),
        (16, 2),
        (40, 0),
        (52, 2),
        (56, 9),
        (64, 9),
        (72, 4),
        (136, 1),
        (344, 7),
    ] {
        let mut corrupt = bytes;
        corrupt[index] = value;
        assert!(
            AtomDivision::from_checkpoint(&corrupt, 8).is_err(),
            "offset {index}"
        );
    }
}

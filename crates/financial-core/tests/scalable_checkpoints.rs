//! Cursor format/domain regressions. Native bytes are not account authentication.
use financial_core::clearing::scalable::{
    cohort_denominator::DenominatorPass,
    comparison::CompareCursor,
    denominator::LcmCursor,
    wide::{Cursor, LimbStorage, Operation},
};
use financial_core::{Error, Result};

struct Memory([[u64; 4]; 3]);
impl LimbStorage for Memory {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        self.0
            .get(register as usize)
            .and_then(|words| words.get(limb as usize))
            .copied()
            .ok_or(Error::Bounds)
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        *self
            .0
            .get_mut(register as usize)
            .and_then(|words| words.get_mut(limb as usize))
            .ok_or(Error::Bounds)? = value;
        Ok(())
    }
}

#[test]
fn arithmetic_checkpoint_has_literal_fixed_wire_and_rejects_unused_fields() {
    let cursor = Cursor::new(
        Operation::Multiply {
            factor: [3, 0, 0, 0, 0],
            length: 1,
        },
        2,
        7,
        7,
        9,
    )
    .unwrap();
    let literal = concat!(
        "01020100010000000200000000000000",
        "07000000070000000900000000000000",
        "00000000000000000000000000000000",
        "00000000000000000300000000000000",
        "00000000000000000000000000000000",
        "00000000000000000000000000000000",
        "00000000000000000000000000000000",
        "00000000000000000000000000000000",
    );
    let expected = literal
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(cursor.checkpoint().as_slice(), expected);
    assert_eq!(
        Cursor::from_checkpoint(&expected, 2)
            .unwrap()
            .checkpoint()
            .as_slice(),
        expected
    );
    assert!(Cursor::from_checkpoint(&expected, 1).is_err());
    for (index, value) in [
        (0, 2),
        (1, 4),
        (2, 4),
        (3, 1),
        (4, 6),
        (5, 1),
        (28, 1),
        (32, 2),
        (40, 1),
        (96, 1),
        (112, 1),
    ] {
        let mut bytes = expected.clone();
        bytes[index] = value;
        assert!(Cursor::from_checkpoint(&bytes, 2).is_err(), "byte {index}");
    }
    assert!(Cursor::from_checkpoint(&expected[..127], 2).is_err());
    let mut alias = expected.clone();
    alias[24..28].copy_from_slice(&7u32.to_le_bytes());
    assert!(Cursor::from_checkpoint(&alias, 2).is_err());
}

#[test]
fn partial_carry_and_completed_encodings_keep_exact_next_step() {
    let mut memory = Memory([[u64::MAX, 0, 0, 0], [1, 0, 0, 0], [0; 4]]);
    let mut cursor = Cursor::new(Operation::Add, 2, 0, 1, 2).unwrap();
    cursor.step(&mut memory).unwrap();
    let bytes = cursor.checkpoint();
    assert_eq!(u64::from_le_bytes(bytes[32..40].try_into().unwrap()), 1);
    assert_eq!(u128::from_le_bytes(bytes[40..56].try_into().unwrap()), 1);
    let mut restored = Cursor::from_checkpoint(&bytes, 2).unwrap();
    assert_eq!(restored.accesses().unwrap()[0].unwrap().limb, 1);
    restored.step(&mut memory).unwrap();
    assert_eq!(memory.0[2], [0, 1, 0, 0]);
    let completed = restored.checkpoint();
    let mut terminal = Cursor::from_checkpoint(&completed, 2).unwrap();
    assert!(terminal.is_done());
    assert!(terminal.step(&mut memory).is_err());
    assert!(terminal.accesses().is_err());
    for offset in [3, 4, 5, 40, 56, 96, 127] {
        let mut malformed = completed;
        malformed[offset] = 2;
        assert!(
            Cursor::from_checkpoint(&malformed, 2).is_err(),
            "offset {offset}"
        );
    }
}

#[test]
fn lcm_restores_every_stage_and_rejects_inconsistent_outer_progress() {
    let mut memory = Memory([[15, 0, 0, 0], [u64::MAX; 4], [u64::MAX; 4]]);
    let mut cursor = LcmCursor::new(1, 4, 0, 1, 2, 14).unwrap();
    let mut visited = 0u8;
    loop {
        let bytes = cursor.checkpoint();
        visited |= 1 << bytes[1];
        cursor = LcmCursor::from_checkpoint(&bytes, 4).unwrap();
        assert_eq!(cursor.checkpoint(), bytes);
        for offset in [0, 2, 20, 72, 208, 223] {
            let mut bad = bytes;
            bad[offset] = 9;
            assert!(
                LcmCursor::from_checkpoint(&bad, 4).is_err(),
                "stage {} offset {offset}",
                bytes[1]
            );
        }
        let mut span = bytes;
        span[32..40].copy_from_slice(&4u64.to_le_bytes());
        assert!(LcmCursor::from_checkpoint(&span, 4).is_err());
        let mut next = bytes;
        next[56..64].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(LcmCursor::from_checkpoint(&next, 4).is_err());
        if cursor.is_done() {
            break;
        }
        cursor.step(&mut memory).unwrap();
    }
    assert_eq!(visited, 0b11_1111);
    assert_eq!(cursor.used().unwrap(), 1);
    assert_eq!(&memory.0[2][..3], &[210, 0, 0]);
    assert!(cursor.step(&mut memory).is_err());
    assert!(cursor.accesses().is_err());
    assert!(LcmCursor::from_checkpoint(&cursor.checkpoint(), 2).is_err());
}

#[test]
fn comparison_rejects_invalid_terminal_or_pending_state() {
    let mut cursor = CompareCursor::new(2, 0, 1).unwrap();
    let memory = Memory([[1, 0, 0, 0], [2, 0, 0, 0], [0; 4]]);
    cursor.step(&memory).unwrap();
    assert!(!cursor.is_done());
    assert!(cursor.result().is_err());
    let bytes = cursor.checkpoint();
    for (offset, value) in [(0, 2), (1, 4), (2, 1), (24, 0), (32, 1)] {
        let mut invalid = bytes;
        invalid[offset] = value;
        assert!(CompareCursor::from_checkpoint(&invalid, 2).is_err());
    }
    let mut restored = CompareCursor::from_checkpoint(&bytes, 2).unwrap();
    restored.step(&memory).unwrap();
    assert_eq!(restored.result().unwrap(), core::cmp::Ordering::Less);
    let mut invalid = restored.checkpoint();
    invalid[24..32].copy_from_slice(&2u64.to_le_bytes());
    assert!(CompareCursor::from_checkpoint(&invalid, 2).is_err());
    assert!(restored.step(&memory).is_err());
}

#[test]
fn denominator_schedule_binds_count_registers_rows_and_every_stage() {
    use financial_core::clearing::row::Row;
    let count = 3;
    let capacity = financial_core::clearing::scalable::wide::required_limbs(count).unwrap();
    let mut memory = Memory([[u64::MAX; 4]; 3]);
    let mut pass = DenominatorPass::new(count, capacity).unwrap();
    let mut initial = [0u8; 320];
    initial[0] = 1;
    initial[8] = 3;
    initial[24] = 1;
    assert_eq!(pass.checkpoint(), initial);
    assert!(pass.row_index().is_err());
    assert!(DenominatorPass::new(3, capacity - 1).is_err());
    let mut stages = 0u8;
    let mut next = 0;
    loop {
        let bytes = pass.checkpoint();
        stages |= 1 << bytes[1];
        pass = DenominatorPass::from_checkpoint(&bytes, count, capacity).unwrap();
        assert_eq!(bytes, pass.checkpoint());
        for offset in [0, 3, 7, 40, 47, 272, 319] {
            let mut corrupt = bytes;
            corrupt[offset] = 8;
            assert!(DenominatorPass::from_checkpoint(&corrupt, count, capacity).is_err());
        }
        assert!(DenominatorPass::from_checkpoint(&bytes, count + 1, capacity).is_err());
        assert!(DenominatorPass::from_checkpoint(&bytes[..319], count, capacity).is_err());
        if pass.is_done() {
            break;
        }
        assert!(pass.result().is_err());
        if let Ok(ordinal) = pass.row_index() {
            assert_eq!(ordinal, next);
            let row = Row {
                cash: 1,
                claims: [-2_000_000_000, -1_000_000_000],
            };
            assert!(pass.accept(ordinal + 1, 100 + next, &row).is_err());
            if next != 0 {
                assert!(pass.accept(ordinal, 100 + next - 1, &row).is_err());
            }
            assert_eq!(pass.checkpoint(), bytes);
            pass.accept(ordinal, 100 + next, &row).unwrap();
            next += 1;
            let mut wrong_register = pass.checkpoint();
            wrong_register[2] ^= 1;
            assert!(DenominatorPass::from_checkpoint(&wrong_register, count, capacity).is_err());
            assert!(pass.accept(ordinal, 100 + next, &row).is_err());
        } else {
            pass.step(&mut memory).unwrap();
        }
    }
    assert_eq!(stages, 0b1111);
    let (register, used) = pass.result().unwrap();
    assert_eq!(used, 1);
    assert_eq!(memory.0[register as usize][0], 3);
    assert!(pass.step(&mut memory).is_err());
    assert!(pass.accesses().is_err());
    assert!(pass.accept(3, 200, &Row::default()).is_err());
}

#[test]
fn snapshot_checkpoints_bind_frozen_buckets_and_preserve_failed_prefix() {
    use financial_core::clearing::{
        row::Row,
        scalable::snapshot::{SnapshotBinding, SnapshotScan},
    };
    let binding = SnapshotBinding {
        count: 2,
        allocated: 39,
        pools: [2, 0],
        insurance: [3, 4],
        fees: [5, 5],
        gross: [4, 0],
    };
    let mut scan = SnapshotScan::new(binding).unwrap();
    scan.accept(
        0,
        100,
        &Row {
            cash: 20,
            claims: [-8_000_000_000, 0],
        },
        [2, 0],
    )
    .unwrap();
    let prefix = scan.checkpoint();
    scan = SnapshotScan::from_checkpoint(&prefix, binding).unwrap();
    assert_eq!(scan.checkpoint(), prefix);
    for offset in [0, 1, 7, 264, 287] {
        let mut corrupt = prefix;
        corrupt[offset] = 9;
        assert!(SnapshotScan::from_checkpoint(&corrupt, binding).is_err());
    }
    for offset in [8, 40, 48, 56, 64, 120, 128, 136, 144, 152, 160] {
        let mut corrupt = prefix;
        corrupt[offset] ^= 1;
        assert!(
            SnapshotScan::from_checkpoint(&corrupt, binding).is_err(),
            "offset {offset}"
        );
    }
    for (offset, value) in [(16, 3u64), (32, 21), (72, 5)] {
        let mut corrupt = prefix;
        corrupt[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        assert!(SnapshotScan::from_checkpoint(&corrupt, binding).is_err());
    }
    let mut too_wide = prefix;
    too_wide[184..192].copy_from_slice(&(1u64 << 23).to_le_bytes());
    assert!(SnapshotScan::from_checkpoint(&too_wide, binding).is_err());
    let bad = Row {
        cash: 0,
        claims: [9_000_000_000, 0],
    };
    assert!(scan.accept(1, 150, &bad, [-2, 0]).is_err());
    assert_eq!(scan.checkpoint(), prefix);
    assert!(scan.result().is_err());
    scan.accept(
        1,
        150,
        &Row {
            claims: [10_000_000_000, 0],
            ..bad
        },
        [-2, 0],
    )
    .unwrap();
    assert_eq!(scan.result().unwrap().cash, 20);
    let terminal = scan.checkpoint();
    assert_eq!(
        SnapshotScan::from_checkpoint(&terminal, binding)
            .unwrap()
            .result()
            .unwrap(),
        scan.result().unwrap()
    );
    assert!(scan.next().is_err());
    assert!(scan.accept(2, 151, &Row::default(), [0; 2]).is_err());
    assert_eq!(scan.checkpoint(), terminal);
}

use financial_core::clearing::scalable::{
    normalized::{Magnitude, NumberCursor},
    wide::{LimbStorage, Operation},
};
use financial_core::{Error, Result};
struct Memory([[u64; 4]; 3]);
impl LimbStorage for Memory {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        self.0
            .get(register as usize)
            .and_then(|v| v.get(limb as usize))
            .copied()
            .ok_or(Error::Bounds)
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        *self
            .0
            .get_mut(register as usize)
            .and_then(|v| v.get_mut(limb as usize))
            .ok_or(Error::Bounds)? = value;
        Ok(())
    }
}
#[test]
fn normalized_checkpoint_binds_capacity_lengths_stage_and_nested_work() {
    let cursor = NumberCursor::new(
        Operation::Add,
        Magnitude {
            register: 0,
            used: 1,
        },
        Magnitude {
            register: 1,
            used: 0,
        },
        2,
        4,
    )
    .unwrap();
    let bytes = cursor.checkpoint();
    assert_eq!(bytes.len(), 192);
    assert_eq!(bytes[0], 1);
    assert_eq!(&bytes[8..16], &4u64.to_le_bytes());
    assert_eq!(&bytes[16..24], &1u64.to_le_bytes());
    assert_eq!(
        NumberCursor::from_checkpoint(&bytes, 4)
            .unwrap()
            .checkpoint(),
        bytes
    );
    assert!(NumberCursor::from_checkpoint(&bytes, 3).is_err());
    for (index, value) in [
        (0, 2),
        (1, 3),
        (2, 1),
        (40, 1),
        (63, 1),
        (16, 5),
        (32, 1),
        (65, 4),
        (66, 2),
    ] {
        let mut corrupt = bytes;
        corrupt[index] = value;
        assert!(
            NumberCursor::from_checkpoint(&corrupt, 4).is_err(),
            "offset {index}"
        );
    }
    let mut memory = Memory([
        [7, u64::MAX, u64::MAX, u64::MAX],
        [u64::MAX; 4],
        [u64::MAX; 4],
    ]);
    let mut cursor = cursor;
    while !cursor.is_done() {
        cursor.step(&mut memory).unwrap();
        cursor = NumberCursor::from_checkpoint(&cursor.checkpoint(), 4).unwrap();
    }
    assert_eq!(
        cursor.result().unwrap(),
        Magnitude {
            register: 2,
            used: 1
        }
    );
    assert_eq!(memory.0[2][0], 7);
    assert!(cursor.accesses().is_err());
    assert!(cursor.step(&mut memory).is_err());
}
#[test]
fn identical_input_registers_cannot_claim_two_different_lengths() {
    assert!(NumberCursor::new(
        Operation::Add,
        Magnitude {
            register: 0,
            used: 1
        },
        Magnitude {
            register: 0,
            used: 0
        },
        2,
        4
    )
    .is_err());
    assert!(NumberCursor::new(
        Operation::Add,
        Magnitude {
            register: 0,
            used: 1
        },
        Magnitude {
            register: 1,
            used: 1
        },
        0,
        4
    )
    .is_err());
}

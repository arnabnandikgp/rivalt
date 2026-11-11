use financial_core::clearing::scalable::{
    insurance_rounds::InsuranceRounds,
    normalized::Magnitude,
    rate_work::{RateInput, RateResult, RateWork},
    snapshot::ClaimTotal,
    wide::{required_limbs, LimbStorage},
};
use financial_core::{clearing::row::Row, Result};

fn input() -> RateInput {
    RateInput {
        count: 2,
        common: Magnitude {
            register: 0,
            used: 1,
        },
        rate_lengths: [1; 2],
        factor: [1, 0, 0, 0, 0],
        positive: [ClaimTotal::default(); 2],
        negative: [ClaimTotal::default(); 2],
        pools: [0; 2],
        budgets: [0; 2],
    }
}
struct Store(Vec<Vec<u64>>);
impl LimbStorage for Store {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        Ok(self.0[register as usize][limb as usize])
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        self.0[register as usize][limb as usize] = value;
        Ok(())
    }
}
#[test]
fn rate_checkpoint_binds_inputs_and_nested_operation() {
    let input = input();
    let bytes = RateWork::new(input).unwrap().checkpoint();
    assert_eq!(bytes.len(), 960);
    assert_eq!(
        RateWork::from_checkpoint(&bytes, input)
            .unwrap()
            .checkpoint(),
        bytes
    );
    let mut other = input;
    other.budgets = [1, 0];
    assert!(RateWork::from_checkpoint(&bytes, other).is_err());
    for (index, value) in [
        (0, 2),
        (1, 34),
        (2, 2),
        (3, 4),
        (4, 4),
        (5, 12),
        (6, 14),
        (7, 0),
        (20, 1),
        (48, 2),
        (216, 3),
        (232, 1),
        (320, 2),
        (336, 1),
        (344, 2),
        (520, 1),
        (536, 4),
        (537, 1),
        (544, 2),
        (736, 1),
        (928, 1),
        (959, 1),
    ] {
        let mut corrupt = bytes;
        corrupt[index] = value;
        assert!(
            RateWork::from_checkpoint(&corrupt, input).is_err(),
            "offset {index}"
        );
    }
}
#[test]
fn complete_row_order_and_terminal_gates_survive_every_step() {
    let input = input();
    let mut work = RateWork::new(input).unwrap();
    let mut store = Store(vec![
        vec![u64::MAX; required_limbs(2).unwrap() as usize];
        25
    ]);
    for register in [0, 3, 4] {
        store.0[register][0] = 1;
    }
    while work.row_index().is_err() {
        work.step(&mut store).unwrap();
    }
    assert!(work.result().is_err());
    let before = work.checkpoint();
    assert!(work.accept(1, 5, Row::default()).is_err());
    assert_eq!(work.checkpoint(), before);
    work.accept(0, 5, Row::default()).unwrap();
    assert_eq!(work.row_index().unwrap(), 1);
    assert!(work.accept(1, 5, Row::default()).is_err());
    assert!(work.accept(1, 4, Row::default()).is_err());
    assert!(work.result().is_err());
    work.accept(1, 6, Row::default()).unwrap();
    while !work.is_done() {
        work.step(&mut store).unwrap();
        work = RateWork::from_checkpoint(&work.checkpoint(), input).unwrap();
    }
    assert_eq!(work.result().unwrap().spent, [0; 2]);
    assert_eq!(work.result().unwrap().fractional, [false; 2]);
    assert!(work.accept(2, 7, Row::default()).is_err());
    assert!(work.step(&mut store).is_err());
}
fn verified(spent: [u64; 2], fractional: [bool; 2]) -> RateResult {
    RateResult {
        spent,
        fractional,
        residuals: [Magnitude {
            register: 19,
            used: 0,
        }; 2],
        losses: [Magnitude {
            register: 21,
            used: 0,
        }; 2],
    }
}
#[test]
fn insurance_clips_once_per_market_and_requires_final_integral_evaluation() {
    let original = [9, 12];
    let mut work = InsuranceRounds::new(original).unwrap();
    assert!(work.result().is_err());
    work.accept(verified([4, 12], [true, false])).unwrap();
    work = InsuranceRounds::from_checkpoint(&work.checkpoint(), original).unwrap();
    assert_eq!(work.budgets(), [4, 12]);
    let before = work;
    assert!(work.accept(verified([3, 12], [true, false])).is_err());
    assert_eq!(work, before);
    assert!(work.accept(verified([4, 12], [false, true])).is_err());
    assert_eq!(work, before);
    work.accept(verified([4, 7], [false, true])).unwrap();
    assert!(work.result().is_err());
    work = InsuranceRounds::from_checkpoint(&work.checkpoint(), original).unwrap();
    assert_eq!(work.budgets(), [4, 7]);
    work.accept(verified([4, 7], [false, false])).unwrap();
    assert_eq!(work.result().unwrap(), ([4, 7], 3));
    assert!(work.accept(verified([4, 7], [false, false])).is_err());
    assert_eq!(
        InsuranceRounds::from_checkpoint(&work.checkpoint(), original).unwrap(),
        work
    );
    for (index, value) in [
        (0, 2),
        (1, 0),
        (2, 0),
        (3, 0),
        (4, 1),
        (8, 8),
        (24, 10),
        (40, 5),
        (56, 1),
    ] {
        let mut bytes = work.checkpoint();
        bytes[index] = value;
        assert!(
            InsuranceRounds::from_checkpoint(&bytes, original).is_err(),
            "offset {index}"
        );
    }
}

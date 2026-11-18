//! Persisted exact wide division with a <2^58 atom quotient. The normalized
//! two-word estimate is corrected at most twice; all comparisons/subtractions
//! run through bounded word cursors. No caller-proposed quotient is trusted.
use super::{
    comparison::CompareCursor,
    normalized::{Magnitude, NumberCursor},
    wide::{LimbStorage, Operation, WordAccess},
};
use crate::{Error, Result};
use core::cmp::Ordering;
pub const CHECKPOINT_BYTES: usize = 384;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Stage {
    Initial,
    Prefix,
    Multiply,
    Product,
    Correct,
    Subtract,
    Remainder,
    Done,
}
#[derive(Clone, Debug)]
pub struct AtomDivision {
    capacity: u64,
    numerator: Magnitude,
    denominator: Magnitude,
    scratch: [u32; 2],
    product: Magnitude,
    remainder: Magnitude,
    quotient: u64,
    prefix: [u64; 5],
    prefix_count: u8,
    corrections: u8,
    stage: Stage,
    arithmetic: Option<NumberCursor>,
    comparison: Option<CompareCursor>,
}
impl AtomDivision {
    pub fn new(
        numerator: Magnitude,
        denominator: Magnitude,
        scratch: [u32; 2],
        capacity: u64,
    ) -> Result<Self> {
        if capacity == 0
            || numerator.used > capacity
            || denominator.used == 0
            || denominator.used > capacity
            || numerator.used > denominator.used.checked_add(1).ok_or(Error::Overflow)?
            || scratch[0] == scratch[1]
            || scratch.iter().any(|register| {
                *register == numerator.register || *register == denominator.register
            })
            || (numerator.register == denominator.register && numerator.used != denominator.used)
        {
            return Err(Error::Bounds);
        }
        let mut cursor = Self {
            capacity,
            numerator,
            denominator,
            scratch,
            product: Magnitude {
                register: scratch[0],
                used: 0,
            },
            remainder: numerator,
            quotient: 0,
            prefix: [0; 5],
            prefix_count: 0,
            corrections: 0,
            stage: Stage::Initial,
            arithmetic: None,
            comparison: None,
        };
        cursor.begin_comparison(Stage::Initial)?;
        Ok(cursor)
    }
    pub fn is_done(&self) -> bool {
        self.stage == Stage::Done
    }
    pub fn result(&self) -> Result<(u64, Magnitude)> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        Ok((self.quotient, self.remainder))
    }
    fn comparison_inputs(&self) -> Result<(Magnitude, Magnitude)> {
        match self.stage {
            Stage::Initial => Ok((self.numerator, self.denominator)),
            Stage::Product => Ok((self.product, self.numerator)),
            Stage::Remainder => Ok((self.remainder, self.denominator)),
            _ => Err(Error::Bounds),
        }
    }
    fn begin_comparison(&mut self, stage: Stage) -> Result<()> {
        self.stage = stage;
        let (left, right) = self.comparison_inputs()?;
        self.comparison = if left.used == right.used && left.used > 0 {
            Some(CompareCursor::new(
                left.used,
                left.register,
                right.register,
            )?)
        } else {
            None
        };
        Ok(())
    }
    fn spare(&self) -> u32 {
        if self.product.register == self.scratch[0] {
            self.scratch[1]
        } else {
            self.scratch[0]
        }
    }
    fn expected_arithmetic(&self) -> Result<NumberCursor> {
        let (operation, left, right, output) = match self.stage {
            Stage::Multiply => (
                Operation::Multiply {
                    factor: [self.quotient, 0, 0, 0, 0],
                    length: 1,
                },
                self.denominator,
                Magnitude {
                    register: self.numerator.register,
                    used: 0,
                },
                self.scratch[0],
            ),
            Stage::Correct => (
                Operation::Subtract,
                self.product,
                self.denominator,
                self.spare(),
            ),
            Stage::Subtract => (
                Operation::Subtract,
                self.numerator,
                self.product,
                self.spare(),
            ),
            _ => return Err(Error::Bounds),
        };
        // The unused multiplier input needs a distinct logical register when
        // numerator and denominator alias. It never requests physical storage.
        let right =
            if matches!(operation, Operation::Multiply { .. }) && right.register == left.register {
                Magnitude {
                    register: self.scratch[1],
                    used: 0,
                }
            } else {
                right
            };
        NumberCursor::new(operation, left, right, output, self.capacity)
    }
    fn begin_arithmetic(&mut self, stage: Stage) -> Result<()> {
        self.stage = stage;
        self.arithmetic = Some(self.expected_arithmetic()?);
        Ok(())
    }
    fn prefix_access(&self) -> Result<Option<WordAccess>> {
        let width = self.denominator.used;
        let (value, index) = match self.prefix_count {
            0 => (self.denominator, Some(width - 1)),
            1 => (self.denominator, width.checked_sub(2)),
            2 => (self.numerator, Some(width)),
            3 => (self.numerator, Some(width - 1)),
            4 => (self.numerator, width.checked_sub(2)),
            _ => return Err(Error::Bounds),
        };
        Ok(index
            .filter(|index| *index < value.used)
            .map(|limb| WordAccess {
                register: value.register,
                limb,
                writable: false,
            }))
    }
    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        if self.is_done() {
            return Err(Error::Bounds);
        }
        if let Some(arithmetic) = &self.arithmetic {
            return arithmetic.accesses();
        }
        if let Some(comparison) = &self.comparison {
            return comparison.accesses();
        }
        if self.stage == Stage::Prefix {
            return Ok([self.prefix_access()?, None, None]);
        }
        self.comparison_inputs()?;
        Ok([None; 3])
    }
    fn estimate(&mut self) -> Result<()> {
        let [top, lower, high, middle, low] = self.prefix;
        if top == 0 {
            return Err(Error::Invariant);
        }
        let shift = top.leading_zeros();
        if shift > 0 && high >> (64 - shift) != 0 {
            return Err(Error::Bounds);
        }
        let shifted = |upper: u64, lower: u64| {
            if shift == 0 {
                upper
            } else {
                (upper << shift) | (lower >> (64 - shift))
            }
        };
        let prefix = (u128::from(shifted(high, middle)) << 64) | u128::from(shifted(middle, low));
        self.quotient =
            u64::try_from(prefix / u128::from(shifted(top, lower))).map_err(|_| Error::Bounds)?;
        self.begin_arithmetic(Stage::Multiply)
    }
    pub fn step(&mut self, store: &mut impl LimbStorage) -> Result<()> {
        if self.is_done() {
            return Err(Error::Bounds);
        }
        if let Some(arithmetic) = &mut self.arithmetic {
            arithmetic.step(store)?;
            if arithmetic.is_done() {
                let result = arithmetic.result()?;
                self.arithmetic = None;
                match self.stage {
                    Stage::Multiply | Stage::Correct => {
                        self.product = result;
                        self.begin_comparison(Stage::Product)?;
                    }
                    Stage::Subtract => {
                        self.remainder = result;
                        self.begin_comparison(Stage::Remainder)?;
                    }
                    _ => return Err(Error::Invariant),
                }
            }
            return Ok(());
        }
        if self.stage == Stage::Prefix {
            self.prefix[usize::from(self.prefix_count)] = match self.prefix_access()? {
                Some(access) => store.read(access.register, access.limb)?,
                None => 0,
            };
            self.prefix_count += 1;
            if self.prefix_count == 5 {
                self.estimate()?;
            }
            return Ok(());
        }
        let order = if let Some(comparison) = &mut self.comparison {
            comparison.step(store)?;
            if !comparison.is_done() {
                return Ok(());
            }
            comparison.result()?
        } else {
            let (left, right) = self.comparison_inputs()?;
            left.used.cmp(&right.used)
        };
        self.comparison = None;
        match self.stage {
            Stage::Initial => {
                if order == Ordering::Less {
                    self.stage = Stage::Done;
                } else {
                    self.stage = Stage::Prefix;
                }
            }
            Stage::Product => {
                if order == Ordering::Greater {
                    if self.corrections == 2 {
                        return Err(Error::Invariant);
                    }
                    self.corrections += 1;
                    self.quotient = self.quotient.checked_sub(1).ok_or(Error::Invariant)?;
                    self.begin_arithmetic(Stage::Correct)?;
                } else {
                    if self.quotient >= 1 << 58 {
                        return Err(Error::Bounds);
                    }
                    self.begin_arithmetic(Stage::Subtract)?;
                }
            }
            Stage::Remainder => {
                if order != Ordering::Less {
                    return Err(Error::Invariant);
                }
                self.stage = Stage::Done;
            }
            _ => return Err(Error::Invariant),
        }
        Ok(())
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage as u8;
        bytes[2] = self.prefix_count;
        bytes[3] = self.corrections;
        bytes[4] = u8::from(self.arithmetic.is_some());
        bytes[5] = u8::from(self.comparison.is_some());
        bytes[8..16].copy_from_slice(&self.capacity.to_le_bytes());
        for (offset, value) in [
            (16, self.numerator),
            (32, self.denominator),
            (56, self.product),
            (72, self.remainder),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.register.to_le_bytes());
            bytes[offset + 8..offset + 16].copy_from_slice(&value.used.to_le_bytes());
        }
        bytes[48..52].copy_from_slice(&self.scratch[0].to_le_bytes());
        bytes[52..56].copy_from_slice(&self.scratch[1].to_le_bytes());
        bytes[88..96].copy_from_slice(&self.quotient.to_le_bytes());
        for (index, value) in self.prefix.into_iter().enumerate() {
            bytes[96 + 8 * index..104 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        if let Some(arithmetic) = &self.arithmetic {
            bytes[136..328].copy_from_slice(&arithmetic.checkpoint());
        }
        if let Some(comparison) = &self.comparison {
            bytes[328..368].copy_from_slice(&comparison.checkpoint());
        }
        bytes
    }
    pub fn from_checkpoint(bytes: &[u8], capacity: u64) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[4] > 1
            || bytes[5] > 1
            || bytes[6..8]
                .iter()
                .chain(&bytes[20..24])
                .chain(&bytes[36..40])
                .chain(&bytes[60..64])
                .chain(&bytes[76..80])
                .chain(&bytes[368..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read64 = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let read32 = |offset| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        let magnitude = |offset| Magnitude {
            register: read32(offset),
            used: read64(offset + 8),
        };
        if read64(8) != capacity {
            return Err(Error::Bounds);
        }
        let mut cursor = Self::new(
            magnitude(16),
            magnitude(32),
            [read32(48), read32(52)],
            capacity,
        )?;
        cursor.product = magnitude(56);
        cursor.remainder = magnitude(72);
        cursor.quotient = read64(88);
        cursor.prefix_count = bytes[2];
        cursor.corrections = bytes[3];
        cursor.prefix = core::array::from_fn(|index| read64(96 + 8 * index));
        cursor.stage = match bytes[1] {
            0 => Stage::Initial,
            1 => Stage::Prefix,
            2 => Stage::Multiply,
            3 => Stage::Product,
            4 => Stage::Correct,
            5 => Stage::Subtract,
            6 => Stage::Remainder,
            7 => Stage::Done,
            _ => return Err(Error::Bounds),
        };
        if cursor.prefix_count > 5
            || cursor.corrections > 2
            || cursor.product.used > capacity
            || cursor.remainder.used > capacity
            || !cursor.scratch.contains(&cursor.product.register)
            || (!cursor.scratch.contains(&cursor.remainder.register)
                && cursor.remainder != cursor.numerator)
            || cursor.prefix[usize::from(cursor.prefix_count)..]
                .iter()
                .any(|value| *value != 0)
        {
            return Err(Error::Bounds);
        }
        match cursor.stage {
            Stage::Initial
                if cursor.prefix_count != 0 || cursor.quotient != 0 || cursor.corrections != 0 =>
            {
                return Err(Error::Bounds)
            }
            Stage::Prefix
                if cursor.prefix_count >= 5 || cursor.quotient != 0 || cursor.corrections != 0 =>
            {
                return Err(Error::Bounds)
            }
            Stage::Multiply
            | Stage::Product
            | Stage::Correct
            | Stage::Subtract
            | Stage::Remainder
                if cursor.prefix_count != 5 =>
            {
                return Err(Error::Bounds)
            }
            Stage::Done
                if cursor.quotient >= 1 << 58
                    || !(cursor.prefix_count == 5
                        || (cursor.prefix_count == 0
                            && cursor.quotient == 0
                            && cursor.remainder == cursor.numerator)) =>
            {
                return Err(Error::Bounds)
            }
            _ => {}
        }
        cursor.arithmetic = None;
        cursor.comparison = None;
        if matches!(
            cursor.stage,
            Stage::Multiply | Stage::Correct | Stage::Subtract
        ) {
            if bytes[4] != 1 {
                return Err(Error::Bounds);
            }
            let arithmetic = NumberCursor::from_checkpoint(&bytes[136..328], capacity)?;
            if arithmetic.is_done()
                || arithmetic.specification() != cursor.expected_arithmetic()?.specification()
            {
                return Err(Error::Bounds);
            }
            cursor.arithmetic = Some(arithmetic);
        } else if bytes[4] != 0 || bytes[136..328].iter().any(|byte| *byte != 0) {
            return Err(Error::Bounds);
        }
        if matches!(
            cursor.stage,
            Stage::Initial | Stage::Product | Stage::Remainder
        ) {
            let (left, right) = cursor.comparison_inputs()?;
            if left.used == right.used && left.used > 0 {
                if bytes[5] != 1 {
                    return Err(Error::Bounds);
                }
                let comparison = CompareCursor::from_checkpoint(&bytes[328..368], capacity)?;
                let expected =
                    CompareCursor::new(left.used, left.register, right.register)?.checkpoint();
                if comparison.is_done() || comparison.checkpoint()[8..24] != expected[8..24] {
                    return Err(Error::Bounds);
                }
                cursor.comparison = Some(comparison);
            }
        }
        if cursor.comparison.is_none()
            && (bytes[5] != 0 || bytes[328..368].iter().any(|byte| *byte != 0))
        {
            return Err(Error::Bounds);
        }
        Ok(cursor)
    }
}

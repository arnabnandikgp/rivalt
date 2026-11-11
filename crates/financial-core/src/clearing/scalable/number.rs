//! Native orchestration of the word-cursor kernel. Values are normalized and
//! population-bounded; no per-member wide value is retained by settlement.
//! P54B supplies paged storage and persists the orchestration between opcodes.
use super::wide::{Cursor, LimbStorage, Operation};
use crate::{Error, Result};
use core::cmp::Ordering;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Number(Vec<u64>);

/// These are native logical-work counters, never CU or transaction counts.
#[derive(Clone, Debug)]
pub struct Arithmetic {
    pub capacity: u64,
    pub steps: u128,
    pub comparisons: u128,
    pub largest_words: u64,
    pub resume_budget: u64,
    pub resumes: u128,
}

pub(crate) fn zeroed<T: Default + Clone>(count: usize) -> Result<Vec<T>> {
    let mut values = Vec::new();
    values.try_reserve_exact(count).map_err(|_| Error::Bounds)?;
    values.resize(count, T::default());
    Ok(values)
}

struct Registers<'a> {
    left: &'a Number,
    right: &'a Number,
    output: Vec<u64>,
}
impl LimbStorage for Registers<'_> {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        let index = usize::try_from(limb).map_err(|_| Error::Bounds)?;
        match register {
            0 => Ok(self.left.word(index)),
            1 => Ok(self.right.word(index)),
            2 => self.output.get(index).copied().ok_or(Error::Bounds),
            _ => Err(Error::Bounds),
        }
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        if register != 2 {
            return Err(Error::Bounds);
        }
        *self
            .output
            .get_mut(usize::try_from(limb).map_err(|_| Error::Bounds)?)
            .ok_or(Error::Bounds)? = value;
        Ok(())
    }
}

impl Arithmetic {
    pub fn new(capacity: u64, resume_budget: u64) -> Result<Self> {
        if capacity == 0 || resume_budget == 0 {
            return Err(Error::Bounds);
        }
        Ok(Self {
            capacity,
            resume_budget,
            steps: 0,
            comparisons: 0,
            largest_words: 0,
            resumes: 0,
        })
    }

    fn execute(
        &mut self,
        operation: Operation,
        width: usize,
        left: &Number,
        right: &Number,
    ) -> Result<(Number, u128)> {
        let width = u64::try_from(width.max(1)).map_err(|_| Error::Bounds)?;
        if width > self.capacity {
            return Err(Error::Bounds);
        }
        self.largest_words = self.largest_words.max(width);
        let mut registers = Registers {
            left,
            right,
            output: zeroed(usize::try_from(width).map_err(|_| Error::Bounds)?)?,
        };
        let mut cursor = Cursor::new(operation, width, 0, 1, 2)?;
        let mut budget = self.resume_budget;
        while !cursor.is_done() {
            cursor.step(&mut registers)?;
            self.steps = self.steps.checked_add(1).ok_or(Error::Overflow)?;
            budget -= 1;
            if budget == 0 && !cursor.is_done() {
                // Exercise exact suspended cursor state. This native copy is
                // not an account codec, epoch fence, or crash-durability claim.
                cursor = cursor.clone();
                self.resumes = self.resumes.checked_add(1).ok_or(Error::Overflow)?;
                budget = self.resume_budget;
            }
        }
        let remainder = if matches!(operation, Operation::Divide { .. }) {
            cursor.remainder()?
        } else {
            0
        };
        Ok((Number::from_words(registers.output), remainder))
    }

    pub fn compare(&mut self, left: &Number, right: &Number) -> Ordering {
        // A persisted comparison needs one pair of words per step. Normalized
        // lengths may decide first; otherwise at most the used width is read.
        if left.0.len() != right.0.len() {
            return left.0.len().cmp(&right.0.len());
        }
        for (first, second) in left.0.iter().zip(&right.0).rev() {
            self.comparisons += 1;
            if first != second {
                return first.cmp(second);
            }
        }
        Ordering::Equal
    }
    pub fn add(&mut self, left: &Number, right: &Number) -> Result<Number> {
        self.execute(
            Operation::Add,
            left.0.len().max(right.0.len()) + 1,
            left,
            right,
        )
        .map(|value| value.0)
    }
    pub fn subtract(&mut self, left: &Number, right: &Number) -> Result<Number> {
        if self.compare(left, right) == Ordering::Less {
            return Err(Error::Invariant);
        }
        self.execute(Operation::Subtract, left.0.len(), left, right)
            .map(|value| value.0)
    }
    pub fn multiply(&mut self, left: &Number, factor: &Number) -> Result<Number> {
        if factor.bits() > 302 {
            return Err(Error::Bounds);
        }
        let mut words = [0; 5];
        words[..factor.0.len()].copy_from_slice(&factor.0);
        let length = factor.0.len().max(1);
        self.execute(
            Operation::Multiply {
                factor: words,
                length: length as u8,
            },
            left.0.len() + length,
            left,
            &Number::default(),
        )
        .map(|value| value.0)
    }
    pub fn divide_small(&mut self, value: &Number, divisor: u128) -> Result<(Number, u128)> {
        self.execute(
            Operation::Divide { divisor },
            value.0.len(),
            value,
            &Number::default(),
        )
    }
    pub fn lcm(&mut self, value: &Number, divisor: u128) -> Result<Number> {
        let (_, remainder) = self.divide_small(value, divisor)?;
        let gcd = super::collection::gcd(divisor, remainder)?;
        let (quotient, remainder) = self.divide_small(value, gcd)?;
        if remainder != 0 {
            return Err(Error::Invariant);
        }
        self.multiply(&quotient, &Number::from(divisor))
    }

    /// Exact wide division with a <2^58 whole-atom quotient. Normalize the top
    /// divisor word, estimate using two numerator words, and correct downward
    /// at most twice (the single-digit division bound). Full-width comparisons
    /// and the final remainder check authenticate the estimate. No float, 58-
    /// pass binary search, or wide-by-wide multiplication is used.
    pub fn divide_atoms(
        &mut self,
        numerator: &Number,
        denominator: &Number,
    ) -> Result<(u64, Number)> {
        if denominator.is_zero() {
            return Err(Error::Bounds);
        }
        if self.compare(numerator, denominator) == Ordering::Less {
            return Ok((0, numerator.clone()));
        }
        let words = denominator.0.len();
        if numerator.0.len() > words + 1 {
            return Err(Error::Bounds);
        }
        let shift = denominator.0[words - 1].leading_zeros();
        // Reject a lost high word before using the normalized two-word prefix.
        if numerator.shifted_word(words + 1, shift) != 0 {
            return Err(Error::Bounds);
        }
        let prefix = (u128::from(numerator.shifted_word(words, shift)) << 64)
            | u128::from(numerator.shifted_word(words - 1, shift));
        let top = denominator.shifted_word(words - 1, shift);
        let mut quotient = u64::try_from(prefix / u128::from(top)).map_err(|_| Error::Bounds)?;
        let mut product = self.multiply(denominator, &Number::from(u128::from(quotient)))?;
        for _ in 0..2 {
            if self.compare(&product, numerator) != Ordering::Greater {
                break;
            }
            quotient = quotient.checked_sub(1).ok_or(Error::Invariant)?;
            product = self.subtract(&product, denominator)?;
        }
        if quotient >= 1 << 58 {
            return Err(Error::Bounds);
        }
        let remainder = self.subtract(numerator, &product)?;
        if self.compare(&remainder, denominator) != Ordering::Less {
            return Err(Error::Invariant);
        }
        Ok((quotient, remainder))
    }
}

impl Number {
    pub fn from_words(mut words: Vec<u64>) -> Self {
        while words.last() == Some(&0) {
            words.pop();
        }
        Self(words)
    }
    pub fn words(&self) -> &[u64] {
        &self.0
    }
    pub fn word(&self, index: usize) -> u64 {
        self.0.get(index).copied().unwrap_or(0)
    }
    pub fn bits(&self) -> u64 {
        self.0.last().map_or(0, |top| {
            (self.0.len() as u64 - 1) * 64 + u64::from(64 - top.leading_zeros())
        })
    }
    pub fn is_zero(&self) -> bool {
        self.0.is_empty()
    }
    fn shifted_word(&self, index: usize, shift: u32) -> u64 {
        if shift == 0 {
            return self.word(index);
        }
        (self.word(index) << shift)
            | if index == 0 {
                0
            } else {
                self.word(index - 1) >> (64 - shift)
            }
    }
}
impl From<u128> for Number {
    fn from(value: u128) -> Self {
        Self::from_words(vec![value as u64, (value >> 64) as u64])
    }
}

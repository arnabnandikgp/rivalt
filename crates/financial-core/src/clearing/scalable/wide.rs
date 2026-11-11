//! Resumable unsigned arithmetic over caller-owned limb storage.
//!
//! Each `step` touches a constant number of words, independent of the total
//! width. The caller authenticates storage/cursor identity and commits a step
//! atomically. A storage/arithmetic error invalidates scratch output; it must not
//! commit a partial operation or turn that scratch into a payout.
use crate::{Error, Result};

/// A private scratch register, not an account address or authority. P54B maps
/// these logical words onto authenticated epoch/attempt-owned account pages.
pub trait LimbStorage {
    fn read(&self, register: u32, limb: u64) -> Result<u64>;
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()>;
}

/// Count-derived bound from K<2^87 and the selected reduced-LCM rate contract.
/// Allocation/rent limits are checked separately; this does not promise that a
/// machine can provision every representable population.
pub fn required_limbs(members: u64) -> Result<u64> {
    if members == 0 {
        return Err(Error::Bounds);
    }
    let population_bits = 64 - (members - 1).leading_zeros();
    let aggregate_bits = 87 + u128::from(population_bits);
    let bits = 88 * u128::from(members) + 4 * aggregate_bits + 16;
    u64::try_from(bits.div_ceil(64)).map_err(|_| Error::Overflow)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Add,
    Subtract,
    /// At most five limbs: the count-derived rate factor is below 2^302.
    Multiply {
        factor: [u64; 5],
        length: u8,
    },
    /// Exact reduced row denominator/remainder work; divisor is below 2^88.
    Divide {
        divisor: u128,
    },
}

/// Persist every field together with the owning epoch/attempt in the eventual
/// account adapter. Fields are private so a native caller cannot skip work by
/// modifying the cursor. `done` describes scratch completion, never settlement.
#[derive(Clone, Debug)]
pub struct Cursor {
    operation: Operation,
    width: u64,
    left: u32,
    right: u32,
    output: u32,
    position: u64,
    column: u8,
    clearing: bool,
    carry: u128,
    done: bool,
}
impl Cursor {
    pub fn new(
        operation: Operation,
        width: u64,
        left: u32,
        right: u32,
        output: u32,
    ) -> Result<Self> {
        if width == 0 || output == left || output == right {
            return Err(Error::Bounds);
        }
        match operation {
            Operation::Multiply { factor, length } => {
                if !(1..=5).contains(&length)
                    || factor[4] >= (1u64 << 46)
                    || factor[usize::from(length)..].iter().any(|limb| *limb != 0)
                {
                    return Err(Error::Bounds);
                }
            }
            Operation::Divide { divisor } if divisor == 0 || divisor >= (1u128 << 88) => {
                return Err(Error::Bounds)
            }
            _ => {}
        }
        Ok(Self {
            operation,
            width,
            left,
            right,
            output,
            position: 0,
            column: 0,
            clearing: matches!(operation, Operation::Multiply { .. }),
            carry: 0,
            done: false,
        })
    }
    pub fn is_done(&self) -> bool {
        self.done
    }
    pub fn remainder(&self) -> Result<u128> {
        if !self.done || !matches!(self.operation, Operation::Divide { .. }) {
            return Err(Error::Bounds);
        }
        Ok(self.carry)
    }
    /// One limb of work; no allocation, width-sized local value or unbounded
    /// scan. Completed cursors reject instead of silently replaying a write.
    pub fn step(&mut self, store: &mut impl LimbStorage) -> Result<()> {
        if self.done {
            return Err(Error::Bounds);
        }
        if self.clearing {
            store.write(self.output, self.position, 0)?;
            self.position += 1;
            if self.position == self.width {
                self.position = 0;
                self.clearing = false;
            }
            return Ok(());
        }
        match self.operation {
            Operation::Add => {
                let sum = u128::from(store.read(self.left, self.position)?)
                    + u128::from(store.read(self.right, self.position)?)
                    + self.carry;
                store.write(self.output, self.position, sum as u64)?;
                self.carry = sum >> 64;
            }
            Operation::Subtract => {
                let (difference, first) = store
                    .read(self.left, self.position)?
                    .overflowing_sub(store.read(self.right, self.position)?);
                let (difference, second) = difference.overflowing_sub(self.carry as u64);
                store.write(self.output, self.position, difference)?;
                self.carry = u128::from(first || second);
            }
            Operation::Multiply { factor, length } => {
                let word = store.read(self.left, self.position)?;
                let destination = self
                    .position
                    .checked_add(u64::from(self.column))
                    .ok_or(Error::Overflow)?;
                if destination >= self.width {
                    if u128::from(word) * u128::from(factor[usize::from(self.column)]) != 0
                        || self.carry != 0
                    {
                        return Err(Error::Overflow);
                    }
                } else {
                    // (2^64-1)^2 + output + carry <= 2^128-1.
                    let product = u128::from(word) * u128::from(factor[usize::from(self.column)])
                        + u128::from(store.read(self.output, destination)?)
                        + self.carry;
                    store.write(self.output, destination, product as u64)?;
                    self.carry = product >> 64;
                }
                self.position += 1;
                if self.position == self.width {
                    if self.carry != 0 {
                        return Err(Error::Overflow);
                    }
                    self.position = 0;
                    self.column += 1;
                    self.done = self.column == length;
                }
                return Ok(());
            }
            Operation::Divide { divisor } => {
                let position = self.width - self.position - 1;
                let word = store.read(self.left, position)?;
                // Remainder<2^88; a half-word shift fits u128. Two exact small
                // divisions replace 64 bit steps without a 152-bit temporary.
                let high = (self.carry << 32) | u128::from(word >> 32);
                let high_quotient = high / divisor;
                let low = ((high % divisor) << 32) | u128::from(word & 0xffff_ffff);
                let quotient = (high_quotient << 32) | (low / divisor);
                store.write(
                    self.output,
                    position,
                    u64::try_from(quotient).map_err(|_| Error::Overflow)?,
                )?;
                self.carry = low % divisor;
            }
        }
        self.position += 1;
        if self.position == self.width {
            if !matches!(self.operation, Operation::Divide { .. }) && self.carry != 0 {
                return Err(Error::Overflow);
            }
            self.done = true;
        }
        Ok(())
    }
}

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

/// Versioned internal cursor encoding, separate from account or price schemas.
/// It may be restored only from authenticated program-owned work state. Syntax
/// validation cannot prove that an untrusted claimed arithmetic prefix happened.
pub const CHECKPOINT_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WordAccess {
    pub register: u32,
    pub limb: u64,
    /// A writable word may also be read by the step (multiply accumulation).
    pub writable: bool,
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

    pub(crate) fn specification(&self) -> (Operation, u64, u32, u32, u32) {
        (
            self.operation,
            self.width,
            self.left,
            self.right,
            self.output,
        )
    }

    pub(crate) fn position(&self) -> u64 {
        self.position
    }

    /// Exact next-word dependencies. An adapter can derive bounded canonical
    /// pages before executing; it must not infer writes from caller-supplied
    /// accounts. Repeated source words are harmless and may share a read page.
    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        if self.done {
            return Err(Error::Bounds);
        }
        let access = |register, limb, writable| {
            Some(WordAccess {
                register,
                limb,
                writable,
            })
        };
        if self.clearing {
            return Ok([access(self.output, self.position, true), None, None]);
        }
        match self.operation {
            Operation::Add | Operation::Subtract => Ok([
                access(self.left, self.position, false),
                access(self.right, self.position, false),
                access(self.output, self.position, true),
            ]),
            Operation::Multiply { .. } => {
                let output = self
                    .position
                    .checked_add(u64::from(self.column))
                    .ok_or(Error::Overflow)?;
                Ok([
                    access(self.left, self.position, false),
                    if output < self.width {
                        access(self.output, output, true)
                    } else {
                        None
                    },
                    None,
                ])
            }
            Operation::Divide { .. } => {
                let position = self.width - self.position - 1;
                Ok([
                    access(self.left, position, false),
                    access(self.output, position, true),
                    None,
                ])
            }
        }
    }

    /// All integers are little endian; reserved and unused opcode fields are
    /// zero. Do not commit this encoding after a failing arithmetic/storage step.
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = match self.operation {
            Operation::Add => 0,
            Operation::Subtract => 1,
            Operation::Multiply { factor, length } => {
                bytes[4] = length;
                for (index, value) in factor.iter().enumerate() {
                    bytes[56 + 8 * index..64 + 8 * index].copy_from_slice(&value.to_le_bytes());
                }
                2
            }
            Operation::Divide { divisor } => {
                bytes[96..112].copy_from_slice(&divisor.to_le_bytes());
                3
            }
        };
        bytes[2] = u8::from(self.clearing) | (u8::from(self.done) << 1);
        bytes[3] = self.column;
        bytes[8..16].copy_from_slice(&self.width.to_le_bytes());
        bytes[16..20].copy_from_slice(&self.left.to_le_bytes());
        bytes[20..24].copy_from_slice(&self.right.to_le_bytes());
        bytes[24..28].copy_from_slice(&self.output.to_le_bytes());
        bytes[32..40].copy_from_slice(&self.position.to_le_bytes());
        bytes[40..56].copy_from_slice(&self.carry.to_le_bytes());
        bytes
    }

    /// Decode only from trusted work-account bytes, never instruction arguments.
    /// The owning adapter binds epoch/attempt/revision, operands, capacity and
    /// account identities; this codec checks structural/internal scalar bounds.
    pub fn from_checkpoint(bytes: &[u8], capacity: u64) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[2] > 3
            || bytes[5..8]
                .iter()
                .chain(&bytes[28..32])
                .chain(&bytes[112..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read_u64 = |start| u64::from_le_bytes(bytes[start..start + 8].try_into().unwrap());
        let read_u32 = |start| u32::from_le_bytes(bytes[start..start + 4].try_into().unwrap());
        let divisor = u128::from_le_bytes(bytes[96..112].try_into().unwrap());
        let factor = core::array::from_fn(|index| read_u64(56 + 8 * index));
        let operation = match bytes[1] {
            0 => Operation::Add,
            1 => Operation::Subtract,
            2 => Operation::Multiply {
                factor,
                length: bytes[4],
            },
            3 => Operation::Divide { divisor },
            _ => return Err(Error::Bounds),
        };
        if (bytes[1] != 2 && (bytes[4] != 0 || factor != [0; 5])) || (bytes[1] != 3 && divisor != 0)
        {
            return Err(Error::Bounds);
        }
        let mut cursor = Self::new(
            operation,
            read_u64(8),
            read_u32(16),
            read_u32(20),
            read_u32(24),
        )?;
        if cursor.width > capacity {
            return Err(Error::Bounds);
        }
        cursor.clearing = bytes[2] & 1 != 0;
        cursor.done = bytes[2] & 2 != 0;
        cursor.column = bytes[3];
        cursor.position = read_u64(32);
        cursor.carry = u128::from_le_bytes(bytes[40..56].try_into().unwrap());
        match operation {
            Operation::Multiply { length, .. } => {
                if cursor.position >= cursor.width
                    || cursor.column > length
                    || cursor.carry > u128::from(u64::MAX)
                    || (cursor.position == 0 && cursor.carry != 0)
                    || (cursor.clearing && (cursor.done || cursor.column != 0 || cursor.carry != 0))
                    || (!cursor.clearing && cursor.done != (cursor.column == length))
                    || (cursor.done && (cursor.position != 0 || cursor.carry != 0))
                {
                    return Err(Error::Bounds);
                }
            }
            _ => {
                if cursor.clearing
                    || cursor.column != 0
                    || cursor.position > cursor.width
                    || cursor.done != (cursor.position == cursor.width)
                    || (cursor.position == 0 && cursor.carry != 0)
                {
                    return Err(Error::Bounds);
                }
                match operation {
                    Operation::Divide { divisor } if cursor.carry >= divisor => {
                        return Err(Error::Bounds)
                    }
                    Operation::Add | Operation::Subtract
                        if cursor.carry > 1 || (cursor.done && cursor.carry != 0) =>
                    {
                        return Err(Error::Bounds)
                    }
                    _ => {}
                }
            }
        }
        Ok(cursor)
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

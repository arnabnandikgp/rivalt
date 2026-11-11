//! Bounded arithmetic on normalized paged magnitudes. Authenticated used lengths
//! hide dirty unused tails; a missing word *inside* a value never becomes zero.
//! These descriptors/checkpoints are arithmetic, not account authority.
use super::wide::{Cursor, LimbStorage, Operation, WordAccess};
use crate::{Error, Result};

pub const CHECKPOINT_BYTES: usize = 192;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Magnitude {
    pub register: u32,
    /// Zero has no used words; every nonzero value's last used word is nonzero.
    pub used: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Stage {
    Compute,
    Normalize,
    Done,
}

#[derive(Clone, Debug)]
pub struct NumberCursor {
    capacity: u64,
    left: Magnitude,
    right: Magnitude,
    stage: Stage,
    scanned: u64,
    arithmetic: Cursor,
}

struct Inputs<'a, S> {
    store: &'a mut S,
    left: Magnitude,
    right: Magnitude,
}
impl<S: LimbStorage> LimbStorage for Inputs<'_, S> {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        if [self.left, self.right]
            .iter()
            .any(|value| value.register == register && limb >= value.used)
        {
            Ok(0)
        } else {
            self.store.read(register, limb)
        }
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        self.store.write(register, limb, value)
    }
}

impl NumberCursor {
    pub fn new(
        operation: Operation,
        left: Magnitude,
        right: Magnitude,
        output: u32,
        capacity: u64,
    ) -> Result<Self> {
        if capacity == 0
            || left.used > capacity
            || right.used > capacity
            || (left.register == right.register && left.used != right.used)
        {
            return Err(Error::Bounds);
        }
        let width = match operation {
            Operation::Add => left
                .used
                .max(right.used)
                .checked_add(1)
                .ok_or(Error::Overflow)?,
            Operation::Subtract => {
                if right.used > left.used {
                    return Err(Error::Invariant);
                }
                left.used.max(1)
            }
            Operation::Multiply { length, .. } => {
                if right.used != 0 {
                    return Err(Error::Bounds);
                }
                left.used
                    .checked_add(u64::from(length))
                    .ok_or(Error::Overflow)?
                    .max(1)
            }
            Operation::Divide { .. } => {
                if right.used != 0 {
                    return Err(Error::Bounds);
                }
                left.used.max(1)
            }
        };
        if width > capacity {
            return Err(Error::Bounds);
        }
        Ok(Self {
            capacity,
            left,
            right,
            stage: Stage::Compute,
            scanned: 0,
            arithmetic: Cursor::new(operation, width, left.register, right.register, output)?,
        })
    }
    pub fn specification(&self) -> (Operation, Magnitude, Magnitude, u32) {
        (
            self.arithmetic.specification().0,
            self.left,
            self.right,
            self.arithmetic.specification().4,
        )
    }
    pub fn is_done(&self) -> bool {
        self.stage == Stage::Done
    }
    pub fn result(&self) -> Result<Magnitude> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        Ok(Magnitude {
            register: self.arithmetic.specification().4,
            used: self.scanned,
        })
    }
    pub fn remainder(&self) -> Result<u128> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        self.arithmetic.remainder()
    }
    /// May be empty for a metadata-only step whose reads are declared zero tails.
    /// A controller still budgets that step and may not invent omitted live words.
    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        match self.stage {
            Stage::Compute => Ok(self.arithmetic.accesses()?.map(|access| {
                access.filter(|access| {
                    access.writable
                        || ![self.left, self.right].iter().any(|value| {
                            value.register == access.register && access.limb >= value.used
                        })
                })
            })),
            Stage::Normalize => Ok([
                Some(WordAccess {
                    register: self.arithmetic.specification().4,
                    limb: self.scanned - 1,
                    writable: false,
                }),
                None,
                None,
            ]),
            Stage::Done => Err(Error::Bounds),
        }
    }
    pub fn step(&mut self, store: &mut impl LimbStorage) -> Result<()> {
        match self.stage {
            Stage::Compute => {
                self.arithmetic.step(&mut Inputs {
                    store,
                    left: self.left,
                    right: self.right,
                })?;
                if self.arithmetic.is_done() {
                    self.scanned = self.arithmetic.specification().1;
                    self.stage = Stage::Normalize;
                }
            }
            Stage::Normalize => {
                if store.read(self.arithmetic.specification().4, self.scanned - 1)? != 0 {
                    self.stage = Stage::Done;
                } else {
                    self.scanned -= 1;
                    if self.scanned == 0 {
                        self.stage = Stage::Done;
                    }
                }
            }
            Stage::Done => return Err(Error::Bounds),
        }
        Ok(())
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage as u8;
        for (index, value) in [self.capacity, self.left.used, self.right.used, self.scanned]
            .into_iter()
            .enumerate()
        {
            bytes[8 + 8 * index..16 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes[64..].copy_from_slice(&self.arithmetic.checkpoint());
        bytes
    }
    /// Structural validation only. Restore bytes and used lengths solely from
    /// program-owned work bound to its frozen epoch/attempt, never keeper arguments.
    pub fn from_checkpoint(bytes: &[u8], capacity: u64) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[2..8]
                .iter()
                .chain(&bytes[40..64])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        if read(8) != capacity {
            return Err(Error::Bounds);
        }
        let arithmetic = Cursor::from_checkpoint(&bytes[64..], capacity)?;
        let (operation, width, left, right, output) = arithmetic.specification();
        let mut cursor = Self::new(
            operation,
            Magnitude {
                register: left,
                used: read(16),
            },
            Magnitude {
                register: right,
                used: read(24),
            },
            output,
            capacity,
        )?;
        if cursor.arithmetic.specification().1 != width {
            return Err(Error::Bounds);
        }
        cursor.stage = match bytes[1] {
            0 => Stage::Compute,
            1 => Stage::Normalize,
            2 => Stage::Done,
            _ => return Err(Error::Bounds),
        };
        cursor.scanned = read(32);
        match cursor.stage {
            Stage::Compute if arithmetic.is_done() || cursor.scanned != 0 => {
                return Err(Error::Bounds)
            }
            Stage::Normalize
                if !arithmetic.is_done() || cursor.scanned == 0 || cursor.scanned > width =>
            {
                return Err(Error::Bounds)
            }
            Stage::Done if !arithmetic.is_done() || cursor.scanned > width => {
                return Err(Error::Bounds)
            }
            _ => {}
        }
        cursor.arithmetic = arithmetic;
        Ok(cursor)
    }
}

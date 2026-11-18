//! Exact LCM extension over normalized, caller-owned registers. Work depends on
//! the USED common width, not the population-derived maximum allocation size.
use super::{
    collection::gcd,
    wide::{Cursor, LimbStorage, Operation, WordAccess},
};
use crate::{Error, Result};
pub const CHECKPOINT_BYTES: usize = 224;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Stage {
    Remainder,
    Quotient,
    ClearHigh,
    Multiply,
    Normalize,
    Done,
}
#[derive(Clone, Debug)]
pub struct LcmCursor {
    input: u32,
    scratch: u32,
    output: u32,
    used: u64,
    span: u64,
    divisor: u128,
    stage: Stage,
    arithmetic: Cursor,
    scanned: u64,
    result_used: u64,
}
impl LcmCursor {
    /// Input's highest declared limb must be nonzero. Scratch and output need
    /// used+2 allocated words; the count-derived capacity independently caps them.
    pub fn new(
        used: u64,
        capacity: u64,
        input: u32,
        scratch: u32,
        output: u32,
        divisor: u128,
    ) -> Result<Self> {
        let span = used.checked_add(2).ok_or(Error::Overflow)?;
        if used == 0 || span > capacity || input == scratch || input == output || scratch == output
        {
            return Err(Error::Bounds);
        }
        Ok(Self {
            input,
            scratch,
            output,
            used,
            span,
            divisor,
            stage: Stage::Remainder,
            arithmetic: Cursor::new(Operation::Divide { divisor }, used, input, input, scratch)?,
            scanned: 0,
            result_used: 0,
        })
    }
    pub fn is_done(&self) -> bool {
        self.stage == Stage::Done
    }
    pub fn used(&self) -> Result<u64> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        Ok(self.result_used)
    }
    /// Bounded next-word dependencies, including the initial canonical length
    /// check. Duplicate reads may map to the same authenticated page.
    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        let access = |register, limb, writable| {
            Some(WordAccess {
                register,
                limb,
                writable,
            })
        };
        match self.stage {
            Stage::Remainder if self.scanned == 0 => {
                let arithmetic = self.arithmetic.accesses()?;
                Ok([
                    access(self.input, self.used - 1, false),
                    arithmetic[0],
                    arithmetic[1],
                ])
            }
            Stage::Remainder | Stage::Quotient | Stage::Multiply => self.arithmetic.accesses(),
            Stage::ClearHigh => Ok([access(self.scratch, self.scanned, true), None, None]),
            Stage::Normalize => Ok([access(self.output, self.scanned - 1, false), None, None]),
            Stage::Done => Err(Error::Bounds),
        }
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage as u8;
        bytes[8..12].copy_from_slice(&self.input.to_le_bytes());
        bytes[12..16].copy_from_slice(&self.scratch.to_le_bytes());
        bytes[16..20].copy_from_slice(&self.output.to_le_bytes());
        bytes[24..32].copy_from_slice(&self.used.to_le_bytes());
        bytes[32..40].copy_from_slice(&self.span.to_le_bytes());
        bytes[40..56].copy_from_slice(&self.divisor.to_le_bytes());
        bytes[56..64].copy_from_slice(&self.scanned.to_le_bytes());
        bytes[64..72].copy_from_slice(&self.result_used.to_le_bytes());
        bytes[80..208].copy_from_slice(&self.arithmetic.checkpoint());
        bytes
    }
    /// The outer work account must authenticate this checkpoint and its pages.
    /// Decoding a structurally valid user-supplied cursor grants no authority.
    pub fn from_checkpoint(bytes: &[u8], capacity: u64) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[2..8]
                .iter()
                .chain(&bytes[20..24])
                .chain(&bytes[72..80])
                .chain(&bytes[208..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read_u64 = |start| u64::from_le_bytes(bytes[start..start + 8].try_into().unwrap());
        let read_u32 = |start| u32::from_le_bytes(bytes[start..start + 4].try_into().unwrap());
        let divisor = u128::from_le_bytes(bytes[40..56].try_into().unwrap());
        let mut cursor = Self::new(
            read_u64(24),
            capacity,
            read_u32(8),
            read_u32(12),
            read_u32(16),
            divisor,
        )?;
        if read_u64(32) != cursor.span {
            return Err(Error::Bounds);
        }
        cursor.stage = match bytes[1] {
            0 => Stage::Remainder,
            1 => Stage::Quotient,
            2 => Stage::ClearHigh,
            3 => Stage::Multiply,
            4 => Stage::Normalize,
            5 => Stage::Done,
            _ => return Err(Error::Bounds),
        };
        cursor.scanned = read_u64(56);
        cursor.result_used = read_u64(64);
        cursor.arithmetic = Cursor::from_checkpoint(&bytes[80..208], capacity)?;
        let (operation, width, left, right, output) = cursor.arithmetic.specification();
        if cursor.stage != Stage::Done && cursor.result_used != 0 {
            return Err(Error::Bounds);
        }
        match cursor.stage {
            Stage::Remainder | Stage::Quotient | Stage::ClearHigh => {
                let Operation::Divide {
                    divisor: current_divisor,
                } = operation
                else {
                    return Err(Error::Bounds);
                };
                if width != cursor.used
                    || left != cursor.input
                    || right != cursor.input
                    || output != cursor.scratch
                    || divisor % current_divisor != 0
                {
                    return Err(Error::Bounds);
                }
                match cursor.stage {
                    Stage::Remainder
                        if current_divisor != divisor
                            || cursor.scanned >= cursor.used
                            || cursor.scanned != cursor.arithmetic.position()
                            || cursor.arithmetic.is_done() =>
                    {
                        return Err(Error::Bounds)
                    }
                    Stage::Quotient
                        if cursor.scanned != cursor.used || cursor.arithmetic.is_done() =>
                    {
                        return Err(Error::Bounds)
                    }
                    Stage::ClearHigh
                        if !(cursor.used..cursor.span).contains(&cursor.scanned)
                            || !cursor.arithmetic.is_done()
                            || cursor.arithmetic.remainder()? != 0 =>
                    {
                        return Err(Error::Bounds)
                    }
                    _ => {}
                }
            }
            Stage::Multiply | Stage::Normalize | Stage::Done => {
                let factor = [divisor as u64, (divisor >> 64) as u64, 0, 0, 0];
                let length = if factor[1] == 0 { 1 } else { 2 };
                if operation != (Operation::Multiply { factor, length })
                    || width != cursor.span
                    || left != cursor.scratch
                    || right != cursor.scratch
                    || output != cursor.output
                {
                    return Err(Error::Bounds);
                }
                match cursor.stage {
                    Stage::Multiply
                        if cursor.scanned != cursor.span || cursor.arithmetic.is_done() =>
                    {
                        return Err(Error::Bounds)
                    }
                    Stage::Normalize
                        if !(cursor.used..=cursor.span).contains(&cursor.scanned)
                            || !cursor.arithmetic.is_done() =>
                    {
                        return Err(Error::Bounds)
                    }
                    Stage::Done
                        if !(cursor.used - 1..cursor.span).contains(&cursor.scanned)
                            || cursor.result_used != cursor.scanned + 1
                            || !cursor.arithmetic.is_done() =>
                    {
                        return Err(Error::Bounds)
                    }
                    _ => {}
                }
            }
        }
        Ok(cursor)
    }
    pub fn step(&mut self, store: &mut impl LimbStorage) -> Result<()> {
        match self.stage {
            Stage::Remainder => {
                // One extra read only on the first step proves the trusted
                // canonical-length precondition without scanning a zero prefix.
                if self.scanned == 0 && store.read(self.input, self.used - 1)? == 0 {
                    return Err(Error::Bounds);
                }
                self.arithmetic.step(store)?;
                self.scanned += 1;
                if self.arithmetic.is_done() {
                    let common = gcd(self.divisor, self.arithmetic.remainder()?)?;
                    self.arithmetic = Cursor::new(
                        Operation::Divide { divisor: common },
                        self.used,
                        self.input,
                        self.input,
                        self.scratch,
                    )?;
                    self.stage = Stage::Quotient;
                }
            }
            Stage::Quotient => {
                self.arithmetic.step(store)?;
                if self.arithmetic.is_done() {
                    if self.arithmetic.remainder()? != 0 {
                        return Err(Error::Invariant);
                    }
                    self.scanned = self.used;
                    self.stage = Stage::ClearHigh;
                }
            }
            Stage::ClearHigh => {
                // Old scratch tails must not enter a later wider multiplication.
                store.write(self.scratch, self.scanned, 0)?;
                self.scanned += 1;
                if self.scanned == self.span {
                    let factor = [self.divisor as u64, (self.divisor >> 64) as u64, 0, 0, 0];
                    let length = if factor[1] == 0 { 1 } else { 2 };
                    self.arithmetic = Cursor::new(
                        Operation::Multiply { factor, length },
                        self.span,
                        self.scratch,
                        self.scratch,
                        self.output,
                    )?;
                    self.stage = Stage::Multiply;
                    self.scanned = self.span;
                }
            }
            Stage::Multiply => {
                self.arithmetic.step(store)?;
                if self.arithmetic.is_done() {
                    self.stage = Stage::Normalize;
                }
            }
            Stage::Normalize => {
                self.scanned -= 1;
                if store.read(self.output, self.scanned)? != 0 {
                    self.result_used = self.scanned + 1;
                    self.stage = Stage::Done;
                } else if self.scanned < self.used {
                    return Err(Error::Invariant);
                }
            }
            Stage::Done => return Err(Error::Bounds),
        }
        Ok(())
    }
}

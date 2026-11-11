//! Exact LCM extension over normalized, caller-owned registers. Work depends on
//! the USED common width, not the population-derived maximum allocation size.
use super::{
    collection::gcd,
    wide::{Cursor, LimbStorage, Operation},
};
use crate::{Error, Result};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

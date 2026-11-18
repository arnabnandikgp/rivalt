//! Original-budget insurance clipping. Only a complete verified rate result may
//! advance this controller; rejected/restarted proposals never consume a round.
use super::rate_work::RateResult;
use crate::{Error, Result, MAX_CASH};

pub const CHECKPOINT_BYTES: usize = 64;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InsuranceRounds {
    original: [u64; 2],
    budgets: [u64; 2],
    spent: [u64; 2],
    clipped: u8,
    evaluations: u8,
    complete: bool,
}
impl InsuranceRounds {
    pub fn new(original: [u64; 2]) -> Result<Self> {
        if original.iter().any(|value| *value > MAX_CASH) {
            return Err(Error::Bounds);
        }
        Ok(Self {
            original,
            budgets: original,
            spent: [0; 2],
            clipped: 0,
            evaluations: 0,
            complete: false,
        })
    }
    pub fn budgets(&self) -> [u64; 2] {
        self.budgets
    }
    pub fn is_done(&self) -> bool {
        self.complete
    }
    pub fn result(&self) -> Result<([u64; 2], u8)> {
        if !self.complete {
            return Err(Error::Bounds);
        }
        Ok((self.spent, self.evaluations))
    }
    /// `verified` must come from RateWork::result over this exact budget pair.
    /// This scalar type is not proof of that historical authenticated execution.
    pub fn accept(&mut self, verified: RateResult) -> Result<()> {
        if self.complete || self.evaluations >= 3 {
            return Err(Error::Bounds);
        }
        let mut next = *self;
        let mut changed = false;
        for market in 0..2 {
            let spent = verified.spent[market];
            if spent > self.budgets[market] {
                return Err(Error::Invariant);
            }
            if verified.fractional[market] {
                if self.clipped & (1 << market) != 0 || spent >= self.budgets[market] {
                    return Err(Error::Invariant);
                }
                next.clipped |= 1 << market;
                next.budgets[market] = spent;
                changed = true;
            }
        }
        next.evaluations += 1;
        if changed && next.evaluations >= 3 {
            return Err(Error::Invariant);
        }
        next.spent = verified.spent;
        next.complete = !changed;
        *self = next;
        Ok(())
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[..4].copy_from_slice(&[1, self.clipped, self.evaluations, u8::from(self.complete)]);
        for (index, value) in self
            .original
            .into_iter()
            .chain(self.budgets)
            .chain(self.spent)
            .enumerate()
        {
            bytes[8 + index * 8..16 + index * 8].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }
    pub fn from_checkpoint(bytes: &[u8], original: [u64; 2]) -> Result<Self> {
        let mut work = Self::new(original)?;
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1] > 3
            || bytes[2] > 3
            || bytes[3] > 1
            || bytes[4..8]
                .iter()
                .chain(&bytes[56..])
                .any(|byte| *byte != 0)
            || bytes[8..24] != work.checkpoint()[8..24]
        {
            return Err(Error::Bounds);
        }
        let word = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        work.budgets = [word(24), word(32)];
        work.spent = [word(40), word(48)];
        work.clipped = bytes[1];
        work.evaluations = bytes[2];
        work.complete = bytes[3] != 0;
        for market in 0..2 {
            let clipped = work.clipped & (1 << market) != 0;
            if work.budgets[market] > original[market]
                || work.spent[market] > work.budgets[market]
                || clipped != (work.budgets[market] < original[market])
            {
                return Err(Error::Bounds);
            }
        }
        let completed = u8::from(work.complete);
        if work.evaluations < completed
            || work.evaluations - completed > work.clipped.count_ones() as u8
            || (work.evaluations == completed && work.clipped != 0)
            || (work.evaluations == 0 && (work.clipped != 0 || work.spent != [0; 2]))
            || (work.evaluations != 0 && !work.complete && work.clipped == 0)
            || (!work.complete && work.evaluations == 3)
        {
            return Err(Error::Bounds);
        }
        Ok(work)
    }
}

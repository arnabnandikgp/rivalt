//! Deterministic complete-row schedule for the common exact denominator.
//! The caller authenticates each frozen row and count. Ordinal/ID checks prevent
//! reordering inside that schedule; they do not replace membership authentication.
use super::{
    collection::ReducedCollection,
    denominator::LcmCursor,
    wide::{required_limbs, LimbStorage, WordAccess},
};
use crate::{clearing::row::Row, Error, Result};

pub const CHECKPOINT_BYTES: usize = 320;
const SCRATCH: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Stage {
    Initialize,
    Row,
    Extend,
    Done,
}

/// Registers 0/1 alternate as the normalized common value; register 2 is private
/// quotient scratch. Neither register choices nor operations come from a keeper.
#[derive(Clone, Debug)]
pub struct DenominatorPass {
    count: u64,
    capacity: u64,
    processed: u64,
    last_id: u64,
    used: u64,
    common: u32,
    stage: Stage,
    extension: Option<LcmCursor>,
}

impl DenominatorPass {
    pub fn new(count: u64, capacity: u64) -> Result<Self> {
        if capacity < required_limbs(count)? {
            return Err(Error::Bounds);
        }
        Ok(Self {
            count,
            capacity,
            processed: 0,
            last_id: 0,
            used: 1,
            common: 0,
            stage: Stage::Initialize,
            extension: None,
        })
    }

    pub fn row_index(&self) -> Result<u64> {
        if self.stage != Stage::Row {
            return Err(Error::Bounds);
        }
        Ok(self.processed)
    }

    /// `row` must be the program-authenticated frozen ordinal, never an uploaded
    /// proposal. Reject an omitted, repeated or non-monotone row before progress.
    pub fn accept(&mut self, ordinal: u64, member_id: u64, row: &Row) -> Result<()> {
        if self.stage != Stage::Row
            || ordinal != self.processed
            || (self.processed != 0 && member_id <= self.last_id)
        {
            return Err(Error::Bounds);
        }
        let divisor = ReducedCollection::for_row(row)?.denominator;
        let extension = if divisor == 1 {
            None
        } else {
            Some(LcmCursor::new(
                self.used,
                self.capacity,
                self.common,
                SCRATCH,
                1 - self.common,
                divisor,
            )?)
        };
        self.last_id = member_id;
        self.extension = extension;
        if self.extension.is_some() {
            self.stage = Stage::Extend;
        } else {
            self.finish_row()?;
        }
        Ok(())
    }

    fn finish_row(&mut self) -> Result<()> {
        self.processed = self.processed.checked_add(1).ok_or(Error::Overflow)?;
        self.stage = if self.processed == self.count {
            Stage::Done
        } else {
            Stage::Row
        };
        self.extension = None;
        Ok(())
    }

    pub fn is_done(&self) -> bool {
        self.stage == Stage::Done
    }

    /// Only the complete pass exposes a result. High unused words are not part
    /// of this normalized value and must not be consumed as zero-padded input.
    pub fn result(&self) -> Result<(u32, u64)> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        Ok((self.common, self.used))
    }

    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        match self.stage {
            Stage::Initialize => Ok([
                Some(WordAccess {
                    register: 0,
                    limb: 0,
                    writable: true,
                }),
                None,
                None,
            ]),
            Stage::Extend => self.extension.as_ref().ok_or(Error::Invariant)?.accesses(),
            _ => Err(Error::Bounds),
        }
    }

    /// One bounded word step. The transaction owner must discard all scratch
    /// and cursor changes on error, and commit both together on success.
    pub fn step(&mut self, store: &mut impl LimbStorage) -> Result<()> {
        match self.stage {
            Stage::Initialize => {
                store.write(0, 0, 1)?;
                self.stage = Stage::Row;
            }
            Stage::Extend => {
                let extension = self.extension.as_mut().ok_or(Error::Invariant)?;
                extension.step(store)?;
                if extension.is_done() {
                    self.used = extension.used()?;
                    self.common = 1 - self.common;
                    self.finish_row()?;
                }
            }
            _ => return Err(Error::Bounds),
        }
        Ok(())
    }

    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage as u8;
        bytes[2] = self.common as u8;
        bytes[8..16].copy_from_slice(&self.count.to_le_bytes());
        bytes[16..24].copy_from_slice(&self.processed.to_le_bytes());
        bytes[24..32].copy_from_slice(&self.used.to_le_bytes());
        bytes[32..40].copy_from_slice(&self.last_id.to_le_bytes());
        if let Some(extension) = &self.extension {
            bytes[48..272].copy_from_slice(&extension.checkpoint());
        }
        bytes
    }

    /// Structural validation only: restore from authenticated work, with the
    /// frozen count and provisioned capacity supplied by its owning controller.
    pub fn from_checkpoint(bytes: &[u8], count: u64, capacity: u64) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[2] > 1
            || bytes[3..8]
                .iter()
                .chain(&bytes[40..48])
                .chain(&bytes[272..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let mut cursor = Self::new(count, capacity)?;
        if read(8) != count {
            return Err(Error::Bounds);
        }
        cursor.processed = read(16);
        cursor.used = read(24);
        cursor.last_id = read(32);
        cursor.common = u32::from(bytes[2]);
        cursor.stage = match bytes[1] {
            0 => Stage::Initialize,
            1 => Stage::Row,
            2 => Stage::Extend,
            3 => Stage::Done,
            _ => return Err(Error::Bounds),
        };
        if cursor.used == 0
            || cursor.used > capacity
            || cursor.processed > count
            || (cursor.stage == Stage::Done) != (cursor.processed == count)
        {
            return Err(Error::Bounds);
        }
        if cursor.stage == Stage::Extend {
            let encoded = &bytes[48..272];
            let extension = LcmCursor::from_checkpoint(encoded, capacity)?;
            let id = |offset| u32::from_le_bytes(encoded[offset..offset + 4].try_into().unwrap());
            let used = u64::from_le_bytes(encoded[24..32].try_into().unwrap());
            if id(8) != cursor.common
                || id(12) != SCRATCH
                || id(16) != 1 - cursor.common
                || used != cursor.used
                || extension.is_done()
                || u128::from_le_bytes(encoded[40..56].try_into().unwrap()) <= 1
            {
                return Err(Error::Bounds);
            }
            cursor.extension = Some(extension);
        } else if bytes[48..272].iter().any(|byte| *byte != 0) {
            return Err(Error::Bounds);
        }
        if cursor.stage == Stage::Initialize
            && (cursor.processed != 0
                || cursor.last_id != 0
                || cursor.used != 1
                || cursor.common != 0)
        {
            return Err(Error::Bounds);
        }
        if cursor.stage == Stage::Row
            && cursor.processed == 0
            && (cursor.last_id != 0 || cursor.used != 1 || cursor.common != 0)
        {
            return Err(Error::Bounds);
        }
        Ok(cursor)
    }
}

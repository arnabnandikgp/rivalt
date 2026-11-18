//! Bounded exact comparison, including its internal persisted cursor format.
//! Restore only from authenticated work state; bytes are not a proof of progress.
use super::wide::{LimbStorage, WordAccess};
use crate::{Error, Result};
use core::cmp::Ordering;

pub const CHECKPOINT_BYTES: usize = 40;

#[derive(Clone, Debug)]
pub struct CompareCursor {
    width: u64,
    left: u32,
    right: u32,
    remaining: u64,
    result: Option<Ordering>,
}
impl CompareCursor {
    pub fn new(width: u64, left: u32, right: u32) -> Result<Self> {
        if width == 0 {
            return Err(Error::Bounds);
        }
        Ok(Self {
            width,
            left,
            right,
            remaining: width,
            result: None,
        })
    }
    pub fn is_done(&self) -> bool {
        self.result.is_some()
    }
    pub fn result(&self) -> Result<Ordering> {
        self.result.ok_or(Error::Bounds)
    }
    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        if self.is_done() {
            return Err(Error::Bounds);
        }
        Ok([
            Some(WordAccess {
                register: self.left,
                limb: self.remaining - 1,
                writable: false,
            }),
            Some(WordAccess {
                register: self.right,
                limb: self.remaining - 1,
                writable: false,
            }),
            None,
        ])
    }
    /// Two word reads. Equal prefixes advance; the first differing high word
    /// completes immediately, with no further value-sized local array or scan.
    pub fn step(&mut self, storage: &impl LimbStorage) -> Result<()> {
        if self.is_done() {
            return Err(Error::Bounds);
        }
        let position = self.remaining - 1;
        let order = storage
            .read(self.left, position)?
            .cmp(&storage.read(self.right, position)?);
        self.remaining = position;
        if order != Ordering::Equal || position == 0 {
            self.result = Some(order);
        }
        Ok(())
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = match self.result {
            None => 0,
            Some(Ordering::Less) => 1,
            Some(Ordering::Equal) => 2,
            Some(Ordering::Greater) => 3,
        };
        bytes[8..16].copy_from_slice(&self.width.to_le_bytes());
        bytes[16..20].copy_from_slice(&self.left.to_le_bytes());
        bytes[20..24].copy_from_slice(&self.right.to_le_bytes());
        bytes[24..32].copy_from_slice(&self.remaining.to_le_bytes());
        bytes
    }
    pub fn from_checkpoint(bytes: &[u8], capacity: u64) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[2..8]
                .iter()
                .chain(&bytes[32..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let mut cursor = Self::new(
            u64::from_le_bytes(bytes[8..16].try_into().unwrap()),
            u32::from_le_bytes(bytes[16..20].try_into().unwrap()),
            u32::from_le_bytes(bytes[20..24].try_into().unwrap()),
        )?;
        cursor.remaining = u64::from_le_bytes(bytes[24..32].try_into().unwrap());
        cursor.result = match bytes[1] {
            0 => None,
            1 => Some(Ordering::Less),
            2 => Some(Ordering::Equal),
            3 => Some(Ordering::Greater),
            _ => return Err(Error::Bounds),
        };
        if cursor.width > capacity
            || cursor.remaining > cursor.width
            || (cursor.result.is_none() && cursor.remaining == 0)
            || (cursor.result.is_some() && cursor.remaining == cursor.width)
            || (cursor.result == Some(Ordering::Equal) && cursor.remaining != 0)
            || (cursor.left == cursor.right
                && matches!(cursor.result, Some(Ordering::Less | Ordering::Greater)))
        {
            return Err(Error::Bounds);
        }
        Ok(cursor)
    }
}

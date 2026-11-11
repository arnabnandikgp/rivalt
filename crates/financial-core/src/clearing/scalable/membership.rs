//! Bounded traversal of the complete frozen financial index. The program must
//! authenticate each requested node/page and prevent mutations for the epoch.
//! Caller-supplied counts/masks alone cannot establish financial membership.
use crate::{Error, Result};

// u64 member IDs / 64 entries per page need 58 page bits: 15 radix-16 levels.
const LEVELS: usize = 15;
const MAX_PAGE: u64 = u64::MAX / 64;
pub const CHECKPOINT_BYTES: usize = 64 + LEVELS * 32;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Frame {
    prefix: u64,
    expected: u64,
    visited: u64,
    next: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Request {
    Node { level: u8, prefix: u64, count: u64 },
    Page { index: u64, count: u8 },
    Member { ordinal: u64, id: u64 },
    Done,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Stage {
    Node,
    Page,
    Member,
    Done,
}

#[derive(Clone, Debug)]
pub struct MembershipCursor {
    count: u64,
    processed: u64,
    depth: u8,
    stage: Stage,
    frames: [Frame; LEVELS],
    page: u64,
    mask: u64,
    page_count: u8,
}
impl MembershipCursor {
    pub fn new(count: u64) -> Result<Self> {
        if count == 0 {
            return Err(Error::Bounds);
        }
        let mut frames = [Frame::default(); LEVELS];
        frames[0].expected = count;
        Ok(Self {
            count,
            processed: 0,
            depth: 0,
            stage: Stage::Node,
            frames,
            page: 0,
            mask: 0,
            page_count: 0,
        })
    }
    pub fn request(&self) -> Request {
        let frame = self.frames[usize::from(self.depth)];
        match self.stage {
            Stage::Node => Request::Node {
                level: 14 - self.depth,
                prefix: frame.prefix,
                count: frame.expected,
            },
            Stage::Page => Request::Page {
                index: self.page,
                count: self.page_count,
            },
            Stage::Member => Request::Member {
                ordinal: self.processed,
                id: self.page * 64 + u64::from(self.mask.trailing_zeros()),
            },
            Stage::Done => Request::Done,
        }
    }
    /// One authenticated node visit: select one populated child or finish this
    /// subtree. At most 16 bounded scalar entries; never a full-cohort scan.
    pub fn node(&mut self, populated: u16, counts: [u64; 16]) -> Result<()> {
        if self.stage != Stage::Node {
            return Err(Error::Bounds);
        }
        let depth = usize::from(self.depth);
        let frame = self.frames[depth];
        let level = 14 - self.depth;
        let mut total = 0u64;
        let mut actual_mask = 0u16;
        for (slot, count) in counts.into_iter().enumerate() {
            total = total.checked_add(count).ok_or(Error::Overflow)?;
            if count != 0 {
                actual_mask |= 1 << slot;
                let child = frame
                    .prefix
                    .checked_mul(16)
                    .and_then(|prefix| prefix.checked_add(slot as u64))
                    .ok_or(Error::Overflow)?;
                if child > MAX_PAGE >> (u32::from(level) * 4) || (level == 0 && count > 64) {
                    return Err(Error::Bounds);
                }
            }
        }
        if populated != actual_mask || total != frame.expected {
            return Err(Error::Cohort);
        }
        let next = (usize::from(frame.next)..16).find(|slot| counts[*slot] != 0);
        if let Some(slot) = next {
            let child = frame.prefix * 16 + slot as u64; // checked for every nonzero child above
            if frame
                .visited
                .checked_add(counts[slot])
                .ok_or(Error::Overflow)?
                > frame.expected
            {
                return Err(Error::Cohort);
            }
            self.frames[depth].next = slot as u8 + 1;
            if level == 0 {
                self.page = child;
                self.page_count = counts[slot] as u8;
                self.stage = Stage::Page;
            } else {
                self.depth += 1;
                self.frames[depth + 1] = Frame {
                    prefix: child,
                    expected: counts[slot],
                    visited: 0,
                    next: 0,
                };
            }
        } else {
            if frame.visited != frame.expected {
                return Err(Error::Cohort);
            }
            if depth == 0 {
                if self.processed != self.count {
                    return Err(Error::Cohort);
                }
                self.frames[0] = Frame::default();
                self.stage = Stage::Done;
            } else {
                let parent = &mut self.frames[depth - 1];
                let visited = parent
                    .visited
                    .checked_add(frame.visited)
                    .ok_or(Error::Overflow)?;
                if visited > parent.expected {
                    return Err(Error::Cohort);
                }
                parent.visited = visited;
                self.frames[depth] = Frame::default();
                self.depth -= 1;
            }
        }
        Ok(())
    }
    pub fn page(&mut self, financial_mask: u64) -> Result<()> {
        if self.stage != Stage::Page || financial_mask.count_ones() != u32::from(self.page_count) {
            return Err(Error::Cohort);
        }
        self.mask = financial_mask;
        self.stage = Stage::Member;
        Ok(())
    }
    /// Call only after successfully valuing this authenticated root and writing
    /// its frozen row in the SAME transaction as this cursor update.
    pub fn member(&mut self, id: u64) -> Result<()> {
        let Request::Member { id: expected, .. } = self.request() else {
            return Err(Error::Bounds);
        };
        if id != expected {
            return Err(Error::Bounds);
        }
        let processed = self.processed.checked_add(1).ok_or(Error::Overflow)?;
        if processed > self.count {
            return Err(Error::Cohort);
        }
        let mask = self.mask & (self.mask - 1);
        if mask == 0 {
            let frame = &mut self.frames[usize::from(self.depth)];
            let visited = frame
                .visited
                .checked_add(u64::from(self.page_count))
                .ok_or(Error::Overflow)?;
            if visited > frame.expected {
                return Err(Error::Cohort);
            }
            frame.visited = visited;
            self.page = 0;
            self.page_count = 0;
            self.stage = Stage::Node;
        }
        self.processed = processed;
        self.mask = mask;
        Ok(())
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.depth;
        bytes[2] = self.stage as u8;
        bytes[3] = self.page_count;
        for (index, scalar) in [self.count, self.processed, self.page, self.mask]
            .into_iter()
            .enumerate()
        {
            bytes[8 + index * 8..16 + index * 8].copy_from_slice(&scalar.to_le_bytes());
        }
        for (index, frame) in self.frames.into_iter().enumerate() {
            let base = 64 + index * 32;
            bytes[base..base + 8].copy_from_slice(&frame.prefix.to_le_bytes());
            bytes[base + 8..base + 16].copy_from_slice(&frame.expected.to_le_bytes());
            bytes[base + 16..base + 24].copy_from_slice(&frame.visited.to_le_bytes());
            bytes[base + 24] = frame.next;
        }
        bytes
    }
    /// Restore only authenticated program-owned frozen work. This checks the
    /// path/count syntax, not that a node or root was historically visited.
    pub fn from_checkpoint(bytes: &[u8], count: u64) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || usize::from(bytes[1]) >= LEVELS
            || bytes[4..8]
                .iter()
                .chain(&bytes[40..64])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let mut cursor = Self::new(count)?;
        if read(8) != count || read(16) > count {
            return Err(Error::Bounds);
        }
        cursor.depth = bytes[1];
        cursor.stage = match bytes[2] {
            0 => Stage::Node,
            1 => Stage::Page,
            2 => Stage::Member,
            3 => Stage::Done,
            _ => return Err(Error::Bounds),
        };
        cursor.page_count = bytes[3];
        cursor.processed = read(16);
        cursor.page = read(24);
        cursor.mask = read(32);
        let mut visited = 0u64;
        for index in 0..LEVELS {
            let base = 64 + index * 32;
            if bytes[base + 25..base + 32].iter().any(|byte| *byte != 0) {
                return Err(Error::Bounds);
            }
            let frame = Frame {
                prefix: read(base),
                expected: read(base + 8),
                visited: read(base + 16),
                next: bytes[base + 24],
            };
            cursor.frames[index] = frame;
            if index > usize::from(cursor.depth) || cursor.stage == Stage::Done {
                if frame != Frame::default() {
                    return Err(Error::Bounds);
                }
                continue;
            }
            let level = LEVELS - 1 - index;
            if frame.expected == 0
                || frame.visited > frame.expected
                || frame.next > 16
                || frame.prefix > MAX_PAGE >> ((level + 1) * 4)
            {
                return Err(Error::Bounds);
            }
            if index == 0 {
                if frame.prefix != 0 || frame.expected != count {
                    return Err(Error::Bounds);
                }
            } else {
                let parent = cursor.frames[index - 1];
                if parent.next == 0
                    || frame.prefix != parent.prefix * 16 + u64::from(parent.next - 1)
                    || parent
                        .visited
                        .checked_add(frame.expected)
                        .ok_or(Error::Overflow)?
                        > parent.expected
                {
                    return Err(Error::Bounds);
                }
            }
            visited = visited.checked_add(frame.visited).ok_or(Error::Overflow)?;
        }
        match cursor.stage {
            Stage::Done => {
                if cursor.depth != 0 || cursor.processed != count {
                    return Err(Error::Bounds);
                }
            }
            Stage::Node => {
                if visited != cursor.processed {
                    return Err(Error::Bounds);
                }
            }
            Stage::Page | Stage::Member => {
                let frame = cursor.frames[usize::from(cursor.depth)];
                if cursor.depth != 14
                    || frame.next == 0
                    || cursor.page > MAX_PAGE
                    || cursor.page != frame.prefix * 16 + u64::from(frame.next - 1)
                    || !(1..=64).contains(&cursor.page_count)
                    || frame
                        .visited
                        .checked_add(u64::from(cursor.page_count))
                        .ok_or(Error::Overflow)?
                        > frame.expected
                {
                    return Err(Error::Bounds);
                }
                let remaining = cursor.mask.count_ones();
                if (cursor.stage == Stage::Page && remaining != 0)
                    || (cursor.stage == Stage::Member
                        && (remaining == 0 || remaining > u32::from(cursor.page_count)))
                {
                    return Err(Error::Bounds);
                }
                let in_page = if cursor.stage == Stage::Page {
                    0
                } else {
                    u64::from(cursor.page_count) - u64::from(remaining)
                };
                if visited.checked_add(in_page).ok_or(Error::Overflow)? != cursor.processed {
                    return Err(Error::Bounds);
                }
            }
        }
        if matches!(cursor.stage, Stage::Node | Stage::Done)
            && (cursor.page != 0 || cursor.mask != 0 || cursor.page_count != 0)
        {
            return Err(Error::Bounds);
        }
        Ok(cursor)
    }
}

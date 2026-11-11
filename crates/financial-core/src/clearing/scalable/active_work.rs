//! Persisted successor/set operations over a paged ordered bit hierarchy.
//! Each step accesses one word. The account owner must authenticate both this
//! checkpoint and the hierarchy; arbitrary bits never authorize graph edges.
use super::wide::{LimbStorage, WordAccess};
use crate::{Error, Result};

pub const CHECKPOINT_BYTES: usize = 64;
const SET: u8 = 0;
const ASCEND: u8 = 1;
const DESCEND: u8 = 2;
const DONE_SET: u8 = 3;
const DONE_NEXT: u8 = 4;

#[derive(Clone, Copy, Debug)]
pub struct Hierarchy {
    length: u64,
    register: u32,
    levels: u8,
    words: u64,
}
impl Hierarchy {
    pub fn new(length: u64, register: u32) -> Result<Self> {
        if length == 0 {
            return Err(Error::Bounds);
        }
        let mut level_words = length.div_ceil(64);
        let mut words = 0u64;
        let mut levels = 0;
        loop {
            words = words.checked_add(level_words).ok_or(Error::Overflow)?;
            levels += 1;
            if level_words == 1 {
                break;
            }
            level_words = level_words.div_ceil(64);
        }
        if levels > 11 {
            return Err(Error::Bounds);
        }
        Ok(Self {
            length,
            register,
            levels,
            words,
        })
    }
    pub fn words(&self) -> u64 {
        self.words
    }
    fn level(&self, level: u8) -> Result<(u64, u64)> {
        if level >= self.levels {
            return Err(Error::Bounds);
        }
        let mut length = self.length.div_ceil(64);
        let mut offset = 0;
        for _ in 0..level {
            offset += length;
            length = length.div_ceil(64);
        }
        Ok((offset, length))
    }
    pub fn set(&self, position: u64, active: bool) -> Result<ActiveWork> {
        if position >= self.length {
            return Err(Error::Bounds);
        }
        Ok(ActiveWork {
            hierarchy: *self,
            stage: SET,
            level: 0,
            active,
            position,
            end: 0,
            found: None,
        })
    }
    pub fn next(&self, start: u64, end: u64) -> Result<ActiveWork> {
        if start > end || end > self.length {
            return Err(Error::Bounds);
        }
        Ok(ActiveWork {
            hierarchy: *self,
            stage: if start == end { DONE_NEXT } else { ASCEND },
            level: 0,
            active: false,
            position: start,
            end,
            found: None,
        })
    }
}
#[derive(Clone, Debug)]
pub struct ActiveWork {
    hierarchy: Hierarchy,
    stage: u8,
    level: u8,
    active: bool,
    position: u64,
    end: u64,
    found: Option<u64>,
}
impl ActiveWork {
    pub(crate) fn matches_set(&self, position: u64, active: bool) -> bool {
        self.stage == SET
            && self.position == position >> (6 * u32::from(self.level))
            && (self.level != 0 || self.active == active)
    }
    pub(crate) fn matches_next(&self, end: u64) -> bool {
        matches!(self.stage, ASCEND | DESCEND) && self.end == end
    }
    pub fn is_done(&self) -> bool {
        self.stage >= DONE_SET
    }
    pub fn result(&self) -> Result<Option<u64>> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        Ok(self.found)
    }
    fn word(&self) -> Result<u64> {
        let (offset, length) = self.hierarchy.level(self.level)?;
        let index = if self.stage == DESCEND {
            self.position
        } else {
            self.position / 64
        };
        if index >= length {
            return Err(Error::Bounds);
        }
        offset.checked_add(index).ok_or(Error::Overflow)
    }
    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        if self.is_done() {
            return Err(Error::Bounds);
        }
        Ok([
            Some(WordAccess {
                register: self.hierarchy.register,
                limb: self.word()?,
                writable: self.stage == SET,
            }),
            None,
            None,
        ])
    }
    pub fn step(&mut self, store: &mut impl LimbStorage) -> Result<()> {
        if self.is_done() {
            return Err(Error::Bounds);
        }
        let address = self.word()?;
        let word = store.read(self.hierarchy.register, address)?;
        if self.stage == SET {
            let mask = 1u64 << (self.position % 64);
            let updated = if self.active {
                word | mask
            } else {
                word & !mask
            };
            store.write(self.hierarchy.register, address, updated)?;
            if (word == 0) == (updated == 0) || self.level + 1 == self.hierarchy.levels {
                self.stage = DONE_SET;
            } else {
                self.active = updated != 0;
                self.position /= 64;
                self.level += 1;
            }
            return Ok(());
        }
        let candidates = if self.stage == ASCEND {
            word & (u64::MAX << (self.position % 64))
        } else {
            word
        };
        if candidates == 0 {
            if self.stage == DESCEND {
                return Err(Error::Invariant);
            }
            let next = self.position / 64 + 1;
            self.level += 1;
            if self.level == self.hierarchy.levels
                || next / 64 >= self.hierarchy.level(self.level)?.1
            {
                self.stage = DONE_NEXT;
                // Terminal checkpoint retains a valid level and word position.
                self.level -= 1;
            } else {
                self.position = next;
            }
        } else {
            let index = if self.stage == DESCEND {
                self.position
            } else {
                self.position / 64
            };
            let found = index
                .checked_mul(64)
                .ok_or(Error::Overflow)?
                .checked_add(u64::from(candidates.trailing_zeros()))
                .ok_or(Error::Overflow)?;
            if self.level == 0 {
                if found >= self.hierarchy.length {
                    return Err(Error::Invariant);
                }
                self.found = (found < self.end).then_some(found);
                self.stage = DONE_NEXT;
            } else {
                self.level -= 1;
                self.position = found;
                self.stage = DESCEND;
            }
        }
        Ok(())
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage;
        bytes[2] = self.level;
        bytes[3] = u8::from(self.active);
        bytes[4] = u8::from(self.found.is_some());
        bytes[8..12].copy_from_slice(&self.hierarchy.register.to_le_bytes());
        for (index, value) in [
            self.hierarchy.length,
            self.position,
            self.end,
            self.found.unwrap_or(0),
        ]
        .into_iter()
        .enumerate()
        {
            bytes[16 + 8 * index..24 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }
    /// Restoring structure alone does not prove that graph/hierarchy writes
    /// happened. Only an authenticated owner may supply the checkpoint.
    pub fn from_checkpoint(bytes: &[u8], hierarchy: Hierarchy) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1] > DONE_NEXT
            || bytes[2] >= hierarchy.levels
            || bytes[3] > 1
            || bytes[4] > 1
            || bytes[5..8]
                .iter()
                .chain(&bytes[12..16])
                .chain(&bytes[48..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        if read(16) != hierarchy.length
            || u32::from_le_bytes(bytes[8..12].try_into().unwrap()) != hierarchy.register
        {
            return Err(Error::Bounds);
        }
        let work = Self {
            hierarchy,
            stage: bytes[1],
            level: bytes[2],
            active: bytes[3] != 0,
            position: read(24),
            end: read(32),
            found: (bytes[4] != 0).then_some(read(40)),
        };
        if work.end > hierarchy.length
            || (bytes[4] == 0 && read(40) != 0)
            || (work.stage != DONE_NEXT && work.found.is_some())
            || work.found.is_some_and(|found| found >= work.end)
            || (matches!(work.stage, SET | DONE_SET) && work.end != 0)
            || (!matches!(work.stage, SET | DONE_SET) && work.active)
            || (work.stage == DESCEND && work.level + 1 >= hierarchy.levels)
        {
            return Err(Error::Bounds);
        }
        // Empty next() may end exactly at length, with no address to load.
        if !work.is_done() {
            work.word()?;
        }
        Ok(work)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};
    #[derive(Default)]
    struct Store {
        words: BTreeMap<u64, u64>,
        permitted: Option<WordAccess>,
    }
    impl LimbStorage for Store {
        fn read(&self, register: u32, limb: u64) -> Result<u64> {
            let access = self.permitted.ok_or(Error::Bounds)?;
            if (register, limb) != (access.register, access.limb) {
                return Err(Error::Invariant);
            }
            Ok(*self.words.get(&limb).unwrap_or(&0))
        }
        fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
            if !self.permitted.ok_or(Error::Bounds)?.writable {
                return Err(Error::Invariant);
            }
            self.read(register, limb)?;
            self.words.insert(limb, value);
            Ok(())
        }
    }
    fn finish(mut work: ActiveWork, store: &mut Store) -> (Option<u64>, u64) {
        let mut steps = 0;
        while !work.is_done() {
            store.permitted = work.accesses().unwrap()[0];
            work.step(store).unwrap();
            work = ActiveWork::from_checkpoint(&work.checkpoint(), work.hierarchy).unwrap();
            steps += 1;
        }
        assert!(work.step(store).is_err());
        assert!(work.accesses().is_err());
        (work.result().unwrap(), steps)
    }
    #[test]
    fn persisted_hierarchy_matches_ordered_set_including_u64_sparse_boundaries() {
        for length in [1, 63, 64, 65, 4095, 4096, 4097, 1_000_003, u64::MAX] {
            let hierarchy = Hierarchy::new(length, 42).unwrap();
            let mut store = Store::default();
            let mut reference = BTreeSet::new();
            let mut seed = 540_003u64;
            for iteration in 0..10_000 {
                let mut random = || {
                    seed = seed
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    seed % length
                };
                let position = if iteration == 0 { length - 1 } else { random() };
                let enabled = iteration % 3 != 2;
                let (_, steps) = finish(hierarchy.set(position, enabled).unwrap(), &mut store);
                assert!(steps <= 11);
                if enabled {
                    reference.insert(position);
                } else {
                    reference.remove(&position);
                }
                let start = random();
                let end = random().max(start).saturating_add(1).min(length);
                let (actual, steps) = finish(hierarchy.next(start, end).unwrap(), &mut store);
                assert!(steps <= 21);
                assert_eq!(actual, reference.range(start..end).next().copied());
            }
            for position in reference {
                finish(hierarchy.set(position, false).unwrap(), &mut store);
            }
            assert_eq!(
                finish(hierarchy.next(0, length).unwrap(), &mut store).0,
                None
            );
            assert!(hierarchy.set(length, true).is_err());
            assert_eq!(
                finish(hierarchy.next(length, length).unwrap(), &mut store).0,
                None
            );
        }
    }
    #[test]
    fn hierarchy_checkpoint_refuses_foreign_bindings_and_bad_structure() {
        let hierarchy = Hierarchy::new(4097, 42).unwrap();
        let work = hierarchy.set(4096, true).unwrap();
        let bytes = work.checkpoint();
        for (offset, value) in [
            (0, 2),
            (1, 5),
            (2, 3),
            (3, 2),
            (4, 2),
            (5, 1),
            (8, 41),
            (12, 1),
            (16, 0),
            (32, 1),
            (40, 1),
            (48, 1),
        ] {
            let mut corrupted = bytes;
            corrupted[offset] = value;
            assert!(
                ActiveWork::from_checkpoint(&corrupted, hierarchy).is_err(),
                "offset {offset}"
            );
        }
        assert!(Hierarchy::new(0, 0).is_err());
        assert!(hierarchy.next(2, 1).is_err());
        assert!(hierarchy.next(0, 4098).is_err());
    }
}

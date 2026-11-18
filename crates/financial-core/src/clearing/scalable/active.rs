//! Ordered active-bit hierarchy. One global index covers contiguous adjacency
//! ranges; no population-sized bit shift or linear scan of inactive arcs.
use super::number::zeroed;
use crate::{Error, Result};

#[derive(Clone, Debug)]
pub struct Active {
    levels: Vec<Vec<u64>>,
    length: usize,
    pub reads: u128,
    pub writes: u128,
}

#[cfg(test)]
mod tests {
    use super::Active;
    use std::collections::BTreeSet;

    #[test]
    fn hierarchy_matches_independent_ordered_set_after_forward_and_reverse_updates() {
        for length in [1, 63, 64, 65, 4095, 4096, 4097, 1_000_003] {
            let mut active = Active::new(length).unwrap();
            let mut reference = BTreeSet::new();
            let mut seed = 540_002u64;
            for iteration in 0..10_000 {
                let mut random = || {
                    seed = seed
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    seed as usize % length
                };
                let position = random();
                let enabled = iteration % 3 != 0;
                let before = active.writes;
                active.set(position, enabled).unwrap();
                assert!(active.writes - before <= 11);
                if enabled {
                    reference.insert(position);
                } else {
                    reference.remove(&position);
                }
                let start = random();
                let end = random().max(start) + 1;
                let before = active.reads;
                assert_eq!(
                    active.next(start, end).unwrap(),
                    reference.range(start..end).next().copied()
                );
                assert!(active.reads - before <= 21);
            }
            for position in reference.clone() {
                active.set(position, false).unwrap();
            }
            assert_eq!(active.next(0, length).unwrap(), None);
            assert!(active.set(length, true).is_err());
            assert!(active.next(0, length + 1).is_err());
        }
    }
}
impl Active {
    pub fn new(length: usize) -> Result<Self> {
        if length == 0 {
            return Err(Error::Bounds);
        }
        let mut levels = Vec::new();
        levels.try_reserve_exact(11).map_err(|_| Error::Bounds)?;
        let mut words = length.div_ceil(64);
        loop {
            levels.push(zeroed(words)?);
            if words == 1 {
                break;
            }
            words = words.div_ceil(64);
        }
        if levels.len() > 11 {
            return Err(Error::Bounds);
        }
        Ok(Self {
            levels,
            length,
            reads: 0,
            writes: 0,
        })
    }
    pub fn words(&self) -> usize {
        self.levels.iter().map(Vec::len).sum()
    }
    pub fn set(&mut self, mut position: usize, mut active: bool) -> Result<()> {
        if position >= self.length {
            return Err(Error::Bounds);
        }
        for level in &mut self.levels {
            let word = &mut level[position / 64];
            let previous = *word;
            let mask = 1u64 << (position % 64);
            *word = if active {
                previous | mask
            } else {
                previous & !mask
            };
            self.reads += 1;
            self.writes += 1;
            if (*word == 0) == (previous == 0) {
                break;
            }
            active = *word != 0;
            position /= 64;
        }
        Ok(())
    }
    /// First live index in [start,end). At most 21 word reads for u64 indices:
    /// ascend at most 11 levels and descend at most ten, including empty ranges.
    pub fn next(&mut self, start: usize, end: usize) -> Result<Option<usize>> {
        if start > end || end > self.length {
            return Err(Error::Bounds);
        }
        if start == end {
            return Ok(None);
        }
        let mut position = start;
        for level in 0..self.levels.len() {
            let word_index = position / 64;
            let Some(word) = self.levels[level].get(word_index) else {
                return Ok(None);
            };
            self.reads += 1;
            let candidates = word & (u64::MAX << (position % 64));
            if candidates != 0 {
                let mut found = word_index * 64 + candidates.trailing_zeros() as usize;
                for lower in (0..level).rev() {
                    let word = *self.levels[lower].get(found).ok_or(Error::Invariant)?;
                    self.reads += 1;
                    if word == 0 {
                        return Err(Error::Invariant);
                    }
                    found = found
                        .checked_mul(64)
                        .ok_or(Error::Overflow)?
                        .checked_add(word.trailing_zeros() as usize)
                        .ok_or(Error::Overflow)?;
                }
                return Ok((found < end).then_some(found));
            }
            position = word_index.checked_add(1).ok_or(Error::Overflow)?;
        }
        Ok(None)
    }
}

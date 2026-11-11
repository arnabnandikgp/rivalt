//! Complete reusable recovery workspace provisioning. Capacity depends on the
//! admitted financial population, never the highest stable member ID or empty
//! registration count. This schedule proves required allocation keys only: the
//! program must authenticate real rent-funded accounts before advancing it.
use super::{
    graph_pages::{Layout, FLOWS, ORDER_ETH},
    pages::PAGE_WORDS,
    wide::required_limbs,
};
use crate::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Allocation {
    Prepared,
    Rates,
    Plan,
    FrozenRows { page: u64 },
    Limbs { register: u32, page: u64 },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecoveryLayout {
    capacity: u64,
    frozen_pages: u64,
    arithmetic_pages: u64,
    scalar_pages: [u64; 7],
    allocations: u64,
}

/// Admission capacity is earned by authenticating every required physical
/// allocation. A caller-supplied capacity or a lamport balance alone is no proof.
/// The program owns authority, rent/PDA checks and writes this state atomically
/// with its account checks. This controller owns order, replay and epoch rules.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Provisioning {
    pub ready_capacity: u64,
    pub target_capacity: u64,
    pub next_allocation: u64,
    pub generation: u64,
    pub locked_epoch: u64,
    pub completed_epoch: u64,
}
impl Provisioning {
    pub fn validate(self) -> Result<()> {
        if self.ready_capacity != 0 {
            RecoveryLayout::new(self.ready_capacity)?;
        }
        if self.target_capacity == 0 {
            if self.next_allocation != 0 {
                return Err(Error::Invariant);
            }
        } else if self.generation == 0
            || self.target_capacity <= self.ready_capacity
            || self.next_allocation >= RecoveryLayout::new(self.target_capacity)?.allocations()
        {
            return Err(Error::Invariant);
        }
        if self.locked_epoch != 0
            && (self.ready_capacity == 0 || self.locked_epoch <= self.completed_epoch)
        {
            return Err(Error::Invariant);
        }
        Ok(())
    }
    pub fn begin(self, capacity: u64) -> Result<Self> {
        self.validate()?;
        RecoveryLayout::new(capacity)?;
        if self.locked_epoch != 0 || self.target_capacity != 0 || capacity <= self.ready_capacity {
            return Err(Error::Bounds);
        }
        Ok(Self {
            target_capacity: capacity,
            generation: self.generation.checked_add(1).ok_or(Error::Overflow)?,
            ..self
        })
    }
    pub fn expected(self, generation: u64, ordinal: u64) -> Result<Allocation> {
        self.validate()?;
        if self.locked_epoch != 0
            || self.target_capacity == 0
            || generation != self.generation
            || ordinal != self.next_allocation
        {
            return Err(Error::Bounds);
        }
        RecoveryLayout::new(self.target_capacity)?.allocation(ordinal)
    }
    /// Invoke only after authenticating the expected actual rent-funded account
    /// and its immutable payer receipt. No partial capacity is admitted.
    pub fn record(self, generation: u64, ordinal: u64) -> Result<Self> {
        self.expected(generation, ordinal)?;
        let next = ordinal.checked_add(1).ok_or(Error::Overflow)?;
        if next == RecoveryLayout::new(self.target_capacity)?.allocations() {
            Ok(Self {
                ready_capacity: self.target_capacity,
                target_capacity: 0,
                next_allocation: 0,
                ..self
            })
        } else {
            Ok(Self {
                next_allocation: next,
                ..self
            })
        }
    }
    pub fn cancel(self, generation: u64) -> Result<Self> {
        self.validate()?;
        if self.locked_epoch != 0 || self.target_capacity == 0 || generation != self.generation {
            return Err(Error::Bounds);
        }
        // Existing allocations/payer receipts stay owned and funded; only this
        // incomplete proof is discarded. Restart gets a new replay generation.
        Ok(Self {
            target_capacity: 0,
            next_allocation: 0,
            ..self
        })
    }
    pub fn admits(self, financial_count: u64) -> Result<()> {
        self.validate()?;
        if self.locked_epoch != 0 || financial_count == 0 || financial_count > self.ready_capacity {
            return Err(Error::Bounds);
        }
        Ok(())
    }
    pub fn lock(self, epoch: u64, financial_count: u64) -> Result<Self> {
        self.admits(financial_count)?;
        if epoch <= self.completed_epoch {
            return Err(Error::Bounds);
        }
        // A pending larger provision is harmless: the already proved capacity
        // stays usable. Its remaining work cannot write during the frozen epoch.
        Ok(Self {
            locked_epoch: epoch,
            ..self
        })
    }
    /// Financial reconciliation/recovery authority belongs to the program. An
    /// untrusted caller may not invoke this based on a claimed completed epoch.
    pub fn unlock(self, epoch: u64) -> Result<Self> {
        self.validate()?;
        if epoch == 0 || self.locked_epoch != epoch {
            return Err(Error::Bounds);
        }
        Ok(Self {
            locked_epoch: 0,
            completed_epoch: epoch,
            ..self
        })
    }
}
impl RecoveryLayout {
    pub fn new(capacity: u64) -> Result<Self> {
        let graph = Layout::new(capacity)?;
        let frozen_pages = capacity.div_ceil(8);
        let arithmetic_pages = required_limbs(capacity)?.div_ceil(PAGE_WORDS);
        let mut scalar_pages = [0; 7];
        let mut allocations = 3u64
            .checked_add(frozen_pages)
            .and_then(|count| count.checked_add(arithmetic_pages.checked_mul(46)?))
            .ok_or(Error::Overflow)?;
        for register in FLOWS..=ORDER_ETH {
            let pages = graph.capacity(register)?.div_ceil(PAGE_WORDS);
            scalar_pages[(register - FLOWS) as usize] = pages;
            allocations = allocations.checked_add(pages).ok_or(Error::Overflow)?;
        }
        Ok(Self {
            capacity,
            frozen_pages,
            arithmetic_pages,
            scalar_pages,
            allocations,
        })
    }
    pub fn capacity(self) -> u64 {
        self.capacity
    }
    pub fn allocations(self) -> u64 {
        self.allocations
    }
    pub fn allocation(self, ordinal: u64) -> Result<Allocation> {
        if ordinal >= self.allocations {
            return Err(Error::Bounds);
        }
        match ordinal {
            0 => return Ok(Allocation::Prepared),
            1 => return Ok(Allocation::Rates),
            2 => return Ok(Allocation::Plan),
            _ => {}
        }
        let mut remaining = ordinal - 3;
        if remaining < self.frozen_pages {
            return Ok(Allocation::FrozenRows { page: remaining });
        }
        remaining -= self.frozen_pages;
        let arithmetic = self
            .arithmetic_pages
            .checked_mul(46)
            .ok_or(Error::Overflow)?;
        if remaining < arithmetic {
            return Ok(Allocation::Limbs {
                register: (remaining / self.arithmetic_pages) as u32,
                page: remaining % self.arithmetic_pages,
            });
        }
        remaining -= arithmetic;
        for (index, pages) in self.scalar_pages.into_iter().enumerate() {
            if remaining < pages {
                return Ok(Allocation::Limbs {
                    register: FLOWS + index as u32,
                    page: remaining,
                });
            }
            remaining -= pages;
        }
        Err(Error::Invariant)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    fn keys(layout: RecoveryLayout) -> BTreeSet<(u8, u32, u64)> {
        (0..layout.allocations())
            .map(|ordinal| match layout.allocation(ordinal).unwrap() {
                Allocation::Prepared => (0, 0, 0),
                Allocation::Rates => (1, 0, 0),
                Allocation::Plan => (2, 0, 0),
                Allocation::FrozenRows { page } => (3, 0, page),
                Allocation::Limbs { register, page } => (4, register, page),
            })
            .collect()
    }
    #[test]
    fn full_capacity_keys_are_unique_cover_worst_width_and_grow_without_relocation() {
        let mut previous = BTreeSet::new();
        for count in [1, 8, 10, 64, 65, 128, 1024, 10_000] {
            let layout = RecoveryLayout::new(count).unwrap();
            let actual = keys(layout);
            assert_eq!(actual.len() as u64, layout.allocations());
            assert!(previous.is_subset(&actual));
            // Independent arithmetic/record packing formulas, including page tails.
            let population_bits = if count == 1 {
                0
            } else {
                64 - (count - 1).leading_zeros() as u64
            };
            let limbs = (88u128 * u128::from(count) + 4 * (87 + u128::from(population_bits)) + 16)
                .div_ceil(64);
            let pages = limbs.div_ceil(256) as u64;
            for register in 0..46 {
                for page in 0..pages {
                    assert!(actual.contains(&(4, register, page)));
                }
                assert!(!actual.contains(&(4, register, pages)));
            }
            for (register, records, per_page) in [
                (64, count, 36),
                (65, count + 5, 28),
                (66, 8 * count + 6, 64),
            ] {
                for page in 0..records.div_ceil(per_page) {
                    assert!(actual.contains(&(4, register, page)));
                }
                assert!(!actual.contains(&(4, register, records.div_ceil(per_page))));
            }
            assert!(layout.allocation(layout.allocations()).is_err());
            previous = actual;
        }
    }
    #[test]
    fn invalid_or_unrepresentable_capacity_rejects_without_wrap() {
        assert!(RecoveryLayout::new(0).is_err());
        assert!(RecoveryLayout::new(u64::MAX).is_err());
        assert!(RecoveryLayout::new(u64::MAX / 8).is_err());
    }

    #[test]
    fn incomplete_proof_never_admits_and_frozen_epoch_blocks_growth_replay() {
        let mut state = Provisioning::default().begin(65).unwrap();
        let allocations = RecoveryLayout::new(65).unwrap().allocations();
        for ordinal in 0..allocations {
            assert!(state.admits(1).is_err());
            assert!(state.record(2, ordinal).is_err());
            assert!(state.record(1, ordinal + 1).is_err());
            if ordinal > 0 {
                assert!(state.record(1, ordinal - 1).is_err());
            }
            state = state.record(1, ordinal).unwrap();
        }
        assert_eq!(state.ready_capacity, 65);
        assert!(state.admits(65).is_ok());
        assert!(state.admits(66).is_err());
        assert!(state.record(1, allocations - 1).is_err());
        state = state.begin(128).unwrap().record(2, 0).unwrap();
        let frozen = state.lock(7, 65).unwrap();
        assert!(frozen.admits(1).is_err());
        assert!(frozen.record(2, 1).is_err());
        assert!(frozen.cancel(2).is_err());
        assert!(frozen.begin(256).is_err());
        assert!(frozen.unlock(6).is_err());
        let resumed = frozen.unlock(7).unwrap();
        assert_eq!(resumed.completed_epoch, 7);
        assert_eq!(resumed.next_allocation, 1);
        assert!(resumed.lock(7, 65).is_err());
        assert!(resumed.lock(8, 65).is_ok());
        assert!(resumed.record(2, 1).is_ok());
        let cancelled = resumed.cancel(2).unwrap();
        assert!(cancelled.admits(65).is_ok());
        let restarted = cancelled.begin(128).unwrap();
        assert_eq!(restarted.generation, 3);
        assert!(restarted.record(2, 0).is_err());
        assert!(restarted.record(3, 0).is_ok());
    }

    #[test]
    fn capacity_and_epoch_exhaustion_reject_instead_of_reviving_old_authority() {
        let initial = Provisioning::default();
        assert!(initial.admits(0).is_err());
        assert!(initial.lock(0, 0).is_err());
        assert!(initial.unlock(0).is_err());
        assert!(Provisioning {
            generation: u64::MAX,
            ..initial
        }
        .begin(1)
        .is_err());
        for corrupt in [
            Provisioning {
                next_allocation: 1,
                ..initial
            },
            Provisioning {
                target_capacity: 1,
                ..initial
            },
            Provisioning {
                locked_epoch: 1,
                ..initial
            },
            Provisioning {
                ready_capacity: 1,
                locked_epoch: 3,
                completed_epoch: 3,
                ..initial
            },
        ] {
            assert!(corrupt.validate().is_err());
            assert!(corrupt.begin(128).is_err());
            assert!(corrupt.admits(1).is_err());
        }
    }
}

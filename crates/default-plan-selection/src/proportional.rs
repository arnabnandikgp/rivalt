//! One debtor can pair with every eligible lot in this market. At fixed total
//! recovery D116 minimizes the sum of charge² / capacity. Buying the kth atom
//! costs (2k−1) / capacity. Those costs strictly increase within each account.
//! The most expensive selected unit and cheapest remaining unit therefore
//! certify the complete distribution in one authenticated scan.
use core::cmp::Ordering;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemberPriority {
    pub digest: [u8; 32],
    pub id: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Marginal {
    pub unit: u64,
    pub capacity: u64,
    pub extra_lots: u64,
    pub member: MemberPriority,
}

impl Marginal {
    /// Return how many units of this member lie at or before the proposed
    /// last selected unit. Only an exact price tie needs the lot cost and
    /// frozen priority. The complete scan must separately verify total recovery.
    pub fn charge(
        &self,
        capacity: u64,
        member: MemberPriority,
        lots: impl Fn(u64) -> Option<u64>,
    ) -> Option<u64> {
        if self.unit == 0 || self.unit > self.capacity {
            return None;
        }
        if capacity == 0 {
            return Some(0);
        }
        let numerator = 2 * u128::from(self.unit) - 1;
        let divisor = u128::from(self.capacity);
        let product = (numerator % divisor) * u128::from(capacity);
        let scaled = (numerator / divisor) * u128::from(capacity) + product / divisor;
        let mut charge = u64::try_from(scaled.div_ceil(2)).ok()?;
        if scaled % 2 == 1 && product % divisor == 0 {
            let extra_lots = lots(charge)?.checked_sub(lots(charge - 1)?)?;
            let tied = Self {
                unit: charge,
                capacity,
                extra_lots,
                member,
            };
            if tied.compare(self).is_gt() {
                charge -= 1;
            }
        }
        Some(charge)
    }

    pub fn compare(&self, other: &Self) -> Ordering {
        compare_unit_cost(self.unit, self.capacity, other.unit, other.capacity)
            .then(self.extra_lots.cmp(&other.extra_lots))
            .then(self.member.digest.cmp(&other.member.digest))
            .then(self.member.id.cmp(&other.member.id))
    }
}

/// Compare (2k−1)/c with full u64 inputs, including a 65-bit numerator.
pub(crate) fn compare_unit_cost(
    unit: u64,
    capacity: u64,
    other_unit: u64,
    other_capacity: u64,
) -> Ordering {
    let parts = |unit: u64, capacity: u64| {
        let numerator = 2 * u128::from(unit) - 1;
        (
            numerator / u128::from(capacity),
            numerator % u128::from(capacity),
        )
    };
    let (whole, rem) = parts(unit, capacity);
    let (other_whole, other_rem) = parts(other_unit, other_capacity);
    whole
        .cmp(&other_whole)
        .then_with(|| (rem * u128::from(other_capacity)).cmp(&(other_rem * u128::from(capacity))))
}

/// Extremal marginal costs of a selected allocation. Combining ranges does
/// not require summing the markets' charges in the per-member u64 unit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MarginalRange {
    pub last_selected: Option<Marginal>,
    pub first_remaining: Option<Marginal>,
}
impl MarginalRange {
    pub fn include(
        &mut self,
        member: MemberPriority,
        capacity: u64,
        charge: u64,
        lots: impl Fn(u64) -> Option<u64>,
    ) -> Option<()> {
        if charge > capacity {
            return None;
        }
        let matched = lots(charge)?;
        let make = |unit, extra_lots| Marginal {
            unit,
            capacity,
            extra_lots,
            member,
        };
        let mut next = *self;
        if charge > 0 {
            let selected = make(charge, matched.checked_sub(lots(charge - 1)?)?);
            if next
                .last_selected
                .is_none_or(|old| old.compare(&selected).is_lt())
            {
                next.last_selected = Some(selected);
            }
        }
        if charge < capacity {
            let remaining = make(charge + 1, lots(charge + 1)?.checked_sub(matched)?);
            if next
                .first_remaining
                .is_none_or(|old| remaining.compare(&old).is_lt())
            {
                next.first_remaining = Some(remaining);
            }
        }
        *self = next;
        Some(())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Boundary {
    pub recovered: u64,
    pub capped_capacity: u64,
    pub last_selected: Option<Marginal>,
    pub first_remaining: Option<Marginal>,
}

impl Boundary {
    /// `lots(k)` comes from clearing's original, authenticated unpaid gain.
    /// It returns the minimum number of lots required to charge exactly k atoms.
    pub fn include(
        &mut self,
        shortfall: u64,
        member: MemberPriority,
        capacity: u64,
        charge: u64,
        lots: impl Fn(u64) -> Option<u64>,
    ) -> Option<()> {
        let recovered = self.recovered.checked_add(charge)?;
        if charge > capacity || recovered > shortfall {
            return None;
        }
        let mut range = MarginalRange {
            last_selected: self.last_selected,
            first_remaining: self.first_remaining,
        };
        range.include(member, capacity, charge, lots)?;
        self.recovered = recovered;
        self.capped_capacity = shortfall.min(self.capped_capacity.saturating_add(capacity));
        self.last_selected = range.last_selected;
        self.first_remaining = range.first_remaining;
        Some(())
    }

    /// Caller must first prove the cursor consumed the entire frozen membership.
    pub fn complete(&self) -> bool {
        self.recovered == self.capped_capacity
            && !matches!((self.last_selected, self.first_remaining),
                (Some(last), Some(first)) if last.compare(&first).is_gt())
    }
}

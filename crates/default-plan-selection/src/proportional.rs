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
        // Each numerator can require 65 bits. Remove the integral part first:
        // each remainder fits in 64 bits, so its cross product fits in 128.
        let parts = |value: &Self| {
            let numerator = 2 * u128::from(value.unit) - 1;
            let capacity = u128::from(value.capacity);
            (numerator / capacity, numerator % capacity)
        };
        let (left, left_rem) = parts(self);
        let (right, right_rem) = parts(other);
        left.cmp(&right)
            .then_with(|| {
                (left_rem * u128::from(other.capacity))
                    .cmp(&(right_rem * u128::from(self.capacity)))
            })
            .then(self.extra_lots.cmp(&other.extra_lots))
            .then(self.member.digest.cmp(&other.member.digest))
            .then(self.member.id.cmp(&other.member.id))
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
        let matched = lots(charge)?;
        let marginal = |unit, extra_lots| Marginal {
            unit,
            capacity,
            extra_lots,
            member,
        };
        let mut last = self.last_selected;
        let mut first = self.first_remaining;
        if charge > 0 {
            let next = marginal(charge, matched.checked_sub(lots(charge - 1)?)?);
            if last.is_none_or(|old| old.compare(&next).is_lt()) {
                last = Some(next);
            }
        }
        if charge < capacity {
            let next = marginal(charge + 1, lots(charge + 1)?.checked_sub(matched)?);
            if first.is_none_or(|old| next.compare(&old).is_lt()) {
                first = Some(next);
            }
        }
        self.recovered = recovered;
        self.capped_capacity = shortfall.min(self.capped_capacity.saturating_add(capacity));
        self.last_selected = last;
        self.first_remaining = first;
        Some(())
    }

    /// Caller must first prove the cursor consumed the entire frozen membership.
    pub fn complete(&self) -> bool {
        self.recovered == self.capped_capacity
            && !matches!((self.last_selected, self.first_remaining),
                (Some(last), Some(first)) if last.compare(&first).is_gt())
    }
}

//! Local prototype of a market gross-lot cap shared among execution lanes.
//! Each lane holds unused capacity. All position changes must apply the delta
//! of the complete, unique set of touched margin accounts. Only clearing may
//! authorize those inputs or move capacity between canonical same-market lanes.

use crate::{Error, Result, MAX_GROSS_LOTS, MAX_LOTS};

/// Only the selected lane and (if needed) explicitly supplied donors change.
/// A donor movement buys no claim and moves no collateral.
#[derive(Debug, Clone, Copy, Default, Eq, PartialEq)]
pub struct Headroom(u64);

impl Headroom {
    /// Begin with all free capacity in one lane at an authenticated snapshot.
    /// Other lanes begin at zero. Initialization must run once per market.
    pub fn initialize(gross: u64) -> Result<Self> {
        MAX_GROSS_LOTS
            .checked_sub(gross)
            .map(Self)
            .ok_or(Error::Bounds)
    }

    /// A fresh market can distribute its available cap evenly, including any
    /// indivisible remainder in increasing maker-instance order.
    pub fn distribute(gross: u64) -> Result<[Self; 3]> {
        let free = Self::initialize(gross)?.available();
        Ok(core::array::from_fn(|index| {
            Self(free / 3 + u64::from((index as u64) < free % 3))
        }))
    }

    pub fn available(self) -> u64 {
        self.0
    }

    fn transfer(source: Self, destination: Self, amount: u64) -> Result<(Self, Self)> {
        let remaining = source.0.checked_sub(amount).ok_or(Error::Bounds)?;
        let received = destination.0.checked_add(amount).ok_or(Error::Overflow)?;
        if received > MAX_GROSS_LOTS {
            return Err(Error::Bounds);
        }
        Ok((Self(remaining), Self(received)))
    }

    pub fn apply(self, change: GrossChange) -> Result<Self> {
        let next = i128::from(self.0) - i128::from(change.0);
        if !(0..=i128::from(MAX_GROSS_LOTS)).contains(&next) {
            return Err(Error::Bounds);
        }
        Ok(Self(next as u64))
    }
}

/// Given all three sealed lanes from one market, move only the deficit needed
/// for this fill, in canonical donor order. Return a candidate without side effects.
/// A local fill only needs its selected lane. Donors earn no withdrawal rights.
pub fn admit_with_donors(
    original: [Headroom; 3],
    selected: usize,
    change: GrossChange,
) -> Result<[Headroom; 3]> {
    let mut lanes = original;
    let local = lanes.get(selected).ok_or(Error::Bounds)?.available();
    let mut deficit = change.additional().saturating_sub(local);
    for donor in 0..lanes.len() {
        if deficit == 0 {
            break;
        }
        if donor == selected {
            continue;
        }
        let borrowed = lanes[donor].available().min(deficit);
        (lanes[donor], lanes[selected]) =
            Headroom::transfer(lanes[donor], lanes[selected], borrowed)?;
        deficit -= borrowed;
    }
    lanes[selected] = lanes[selected].apply(change)?;
    Ok(lanes)
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct GrossChange(i64);

impl GrossChange {
    /// Inputs are the authenticated trader and distinct maker/receiver roots.
    /// The delta of absolute lots can be zero on a real fill, or negative even
    /// when execution used a different maker to open the trader's position.
    pub fn from_positions(changes: &[(i64, i64)]) -> Result<Self> {
        if !(2..=3).contains(&changes.len()) {
            return Err(Error::Cohort);
        }
        let mut net = 0i128;
        let mut gross = 0i128;
        for &(before, after) in changes {
            let prior = before.unsigned_abs();
            let next = after.unsigned_abs();
            if prior > MAX_LOTS as u64 || next > MAX_LOTS as u64 {
                return Err(Error::Bounds);
            }
            net += i128::from(after) - i128::from(before);
            gross += i128::from(next) - i128::from(prior);
        }
        if net != 0 {
            return Err(Error::Invariant);
        }
        Ok(Self(i64::try_from(gross).map_err(|_| Error::Overflow)?))
    }

    pub fn additional(self) -> u64 {
        u64::try_from(self.0).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_local_admissions_cannot_use_the_same_last_two_lots() {
        let (mut first, mut second) = Headroom::transfer(
            Headroom::initialize(MAX_GROSS_LOTS - 2).unwrap(),
            Headroom::default(),
            1,
        )
        .unwrap();
        let open = GrossChange::from_positions(&[(0, 1), (0, -1)]).unwrap();
        assert!(first.apply(open).is_err() && second.apply(open).is_err());
        (second, first) = Headroom::transfer(second, first, 1).unwrap();
        let full = first.apply(open).unwrap();
        assert_eq!((full.available(), second.available()), (0, 0));
        assert!(second.apply(open).is_err());
        assert_eq!(first.available(), 2); // The caller holds the candidate until atomic commit.
    }

    #[test]
    fn a_different_maker_can_close_or_reverse_a_position() {
        let (mut first, mut second) =
            Headroom::transfer(Headroom::initialize(0).unwrap(), Headroom::default(), 9).unwrap();
        // Trader long 3 versus A. A different trader is short 4 versus B.
        first = first
            .apply(GrossChange::from_positions(&[(0, 3), (0, -3)]).unwrap())
            .unwrap();
        second = second
            .apply(GrossChange::from_positions(&[(0, -4), (0, 4)]).unwrap())
            .unwrap();
        assert_eq!(second.available(), 1);
        // Trader sells 4 to B. B goes from +4 to +8. The trader crosses zero.
        let reverse = GrossChange::from_positions(&[(3, -1), (4, 8)]).unwrap();
        assert_eq!(reverse.additional(), 2);
        assert!(second.apply(reverse).is_err());
        (first, second) = Headroom::transfer(first, second, 1).unwrap();
        second = second.apply(reverse).unwrap();
        assert_eq!(MAX_GROSS_LOTS - first.available() - second.available(), 16);
        // A second trader buys from B. Their opposite positions both shrink by 4.
        second = second
            .apply(GrossChange::from_positions(&[(-4, 0), (8, 4)]).unwrap())
            .unwrap();
        assert_eq!(second.available(), 8);
        assert_eq!(MAX_GROSS_LOTS - first.available() - second.available(), 8);
    }

    #[test]
    fn every_split_can_admit_exactly_the_routes_that_fit_the_market() {
        // Exhaust all allocations of the last 0..12 gross lots, including no
        // free capacity. Independently recalculate market gross from all roots.
        for left in -3i64..=3 {
            for right in -3i64..=3 {
                let trader = -left - right;
                for first_leg in -2i64..=2 {
                    for second_leg in -2i64..=2 {
                        if first_leg == 0 || first_leg * second_leg < 0 {
                            continue;
                        }
                        let before = [trader, left, right];
                        let after = [
                            trader + first_leg + second_leg,
                            left - first_leg,
                            right - second_leg,
                        ];
                        let changes = [(before[0], after[0]), (left, after[1]), (right, after[2])];
                        let change = GrossChange::from_positions(&changes).unwrap();
                        let previous: u64 = before.iter().map(|n| n.unsigned_abs()).sum();
                        let resulting: u64 = after.iter().map(|n| n.unsigned_abs()).sum();
                        for free in (0..=12).step_by(2) {
                            let unaffected = MAX_GROSS_LOTS - free - previous;
                            for local in 0..=free {
                                let (donor, selected) = Headroom::transfer(
                                    Headroom::initialize(MAX_GROSS_LOTS - free).unwrap(),
                                    Headroom::default(),
                                    local,
                                )
                                .unwrap();
                                let need = change.additional().saturating_sub(selected.available());
                                let third = donor.available() / 2;
                                let (other, last) =
                                    Headroom::transfer(donor, Headroom::default(), third).unwrap();
                                let committed =
                                    admit_with_donors([selected, other, last], 0, change);
                                assert_eq!(
                                    committed.is_ok(),
                                    unaffected + resulting <= MAX_GROSS_LOTS
                                );
                                if let Ok([lane, other, last]) = committed {
                                    assert_eq!(
                                        other.available() + last.available(),
                                        donor.available() - need
                                    );
                                    assert_eq!(
                                        other.available()
                                            + last.available()
                                            + lane.available()
                                            + unaffected
                                            + resulting,
                                        MAX_GROSS_LOTS
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn malformed_or_unbalanced_positions_cannot_release_headroom() {
        assert!(GrossChange::from_positions(&[(4, 0)]).is_err());
        assert!(GrossChange::from_positions(&[(4, 0), (-3, 0)]).is_err());
        assert!(GrossChange::from_positions(&[(i64::MIN, 0), (0, i64::MIN)]).is_err());
        assert!(Headroom::initialize(MAX_GROSS_LOTS + 1).is_err());
        let empty = Headroom::default();
        assert!(Headroom::transfer(empty, empty, 1).is_err());
    }
}

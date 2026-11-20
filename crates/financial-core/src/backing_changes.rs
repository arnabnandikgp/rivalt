//! Aggregate replacements of previously covered members. Clearing authenticates
//! before/after roots, proof membership and lane generation. A fold is an exact
//! change to a serial checkpoint; membership count never changes on a trade.
use super::{scalar, subtract, ClaimTotal, Contribution, Summary};
use crate::{Error, Result};

pub const LANE_COUNT: usize = 3;

#[derive(Copy, Clone, Default, Debug, PartialEq, Eq)]
pub struct Change {
    pub bad: i128,
    pub quantity: i128,
    pub positive: i128,
    pub negative: i128,
    pub required: [i128; 2],
}

impl Change {
    fn add(self, other: Self) -> Result<Self> {
        let add = |a: i128, b: i128| a.checked_add(b).ok_or(Error::Overflow);
        Ok(Self {
            bad: add(self.bad, other.bad)?,
            quantity: add(self.quantity, other.quantity)?,
            positive: add(self.positive, other.positive)?,
            negative: add(self.negative, other.negative)?,
            required: [
                add(self.required[0], other.required[0])?,
                add(self.required[1], other.required[1])?,
            ],
        })
    }

    // Three lane changes plus the serial quantity must fit a signed accumulator.
    // An exhausted lane can fold into the checkpoint before another admission.
    fn validate_lane(self) -> Result<()> {
        let limit = (i128::MAX / (LANE_COUNT as i128 + 1)) as u128;
        if [
            self.bad,
            self.quantity,
            self.positive,
            self.negative,
            self.required[0],
            self.required[1],
        ]
        .into_iter()
        .any(|value| value.unsigned_abs() > limit)
        {
            return Err(Error::Bounds);
        }
        Ok(())
    }

    pub fn record(self, old: Contribution, new: Contribution) -> Result<Self> {
        self.validate_lane()?;
        old.validate()?;
        new.validate()?;
        let mask =
            |value: Contribution, index: usize| i128::from(value.required & (1 << index) != 0);
        let next = self.add(Self {
            bad: i128::from(new.bad) - i128::from(old.bad),
            quantity: i128::from(new.quantity) - i128::from(old.quantity),
            positive: new.fixed.max(0) - old.fixed.max(0),
            negative: old.fixed.min(0) - new.fixed.min(0),
            required: [mask(new, 0) - mask(old, 0), mask(new, 1) - mask(old, 1)],
        })?;
        next.validate_lane()?;
        Ok(next)
    }
}

/// Apply all execution lanes together. A trader can open on one maker and
/// close on another, so a single lane's intermediate balance can be negative.
pub fn apply(checkpoint: Summary, changes: [Change; LANE_COUNT]) -> Result<Summary> {
    checkpoint.validate()?;
    let mut total = Change::default();
    for lane in changes {
        lane.validate_lane()?;
        total = total.add(lane)?;
    }
    let count = |before: u64, delta: i128| -> Result<u64> {
        u64::try_from(
            i128::from(before)
                .checked_add(delta)
                .ok_or(Error::Overflow)?,
        )
        .map_err(|_| Error::Cohort)
    };
    let magnitude = |before: ClaimTotal, delta: i128| -> Result<ClaimTotal> {
        let amount = scalar(delta.unsigned_abs())?;
        if delta >= 0 {
            before.add(amount)
        } else {
            subtract(before, amount)
        }
    };
    let result = Summary {
        count: checkpoint.count,
        bad: count(checkpoint.bad, total.bad)?,
        quantity: checkpoint
            .quantity
            .checked_add(total.quantity)
            .ok_or(Error::Overflow)?,
        positive: magnitude(checkpoint.positive, total.positive)?,
        negative: magnitude(checkpoint.negative, total.negative)?,
        required: [
            count(checkpoint.required[0], total.required[0])?,
            count(checkpoint.required[1], total.required[1])?,
        ],
    };
    result.validate()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn position(quantity: i64, fixed: i128, bad: bool, required: u8) -> Contribution {
        Contribution {
            quantity,
            fixed,
            bad,
            required,
        }
    }
    #[test]
    fn payment_depends_on_all_makers_even_after_a_cross_maker_close() {
        let flat = position(0, 0, false, 0);
        let first = position(3, -21, true, 3);
        let closed = position(0, 6, false, 0);
        let counter = position(0, -6, false, 0);
        let base = Summary::default()
            .insert(flat)
            .unwrap()
            .insert(counter)
            .unwrap();
        let mut lanes = [Change::default(); LANE_COUNT];
        lanes[2] = lanes[2].record(flat, first).unwrap();
        lanes[0] = lanes[0].record(first, closed).unwrap();
        // Closing removes 21 negative fixed units and one bad account from a
        // different lane. Applying just that lane would consume nonexistent stock.
        assert!(apply(base, [lanes[0], Change::default(), Change::default()]).is_err());
        let folded = apply(base, lanes).unwrap();
        assert_eq!(
            (folded.count(), folded.bad(), folded.required_mask()),
            (2, 0, 0)
        );
        assert_eq!(folded.positive.words(), [6, 0, 0]);
        assert_eq!(folded.negative.words(), [6, 0, 0]);
        assert_eq!(folded.arithmetically_ready(2, 0), Ok(true));
        assert_eq!(
            folded,
            base.replace(flat, first)
                .unwrap()
                .replace(first, closed)
                .unwrap()
        );
    }
    #[test]
    fn large_cohort_totals_do_not_narrow_to_a_signed_delta() {
        let value = position(0, super::super::MAX_FIXED as i128, false, 0);
        let mut encoded = Summary::default().checkpoint();
        let members = u64::MAX;
        encoded[8..16].copy_from_slice(&members.to_le_bytes());
        let words = super::super::product(super::super::MAX_FIXED, members)
            .unwrap()
            .words();
        for (i, word) in words.iter().enumerate() {
            encoded[40 + 8 * i..48 + 8 * i].copy_from_slice(&word.to_le_bytes());
        }
        let base = Summary::from_checkpoint(&encoded).unwrap();
        let flat = position(0, 0, false, 0);
        let delta = Change::default().record(value, flat).unwrap();
        assert_eq!(
            apply(base, [delta, Change::default(), Change::default()]).unwrap(),
            base.replace(value, flat).unwrap()
        );
        let too_large = Change {
            positive: i128::MAX,
            ..Change::default()
        };
        assert!(apply(base, [too_large, Change::default(), Change::default()]).is_err());
    }
}

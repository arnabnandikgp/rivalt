//! Native selection for a single market on a complete three-market freeze.
use crate::{
    joint_priority::{sharing, Profile},
    member_priority,
};
use core::cmp::Ordering;
use financial_core::{
    clearing::three_market::{
        reduction::competition::{Allocation, Contest},
        Amount,
    },
    Error, Result,
};

pub struct Selected {
    pub allocation: Allocation,
    pub examined: u64,
}

/// For a fixed total, weighted squared deviation is a positive constant times
/// (left - total * weight_left / weight_sum)^2. Visit the floor and ceiling
/// together, then expand one atom on each side. A later layer is strictly worse.
fn splits_by_deviation(total: u64, weights: [u64; 2]) -> impl Iterator<Item = [Option<u64>; 2]> {
    let numerator = u128::from(total) * u128::from(weights[0]);
    let denominator = u128::from(weights[0]) + u128::from(weights[1]);
    let floor = (numerator / denominator) as u64;
    let ceil = numerator.div_ceil(denominator) as u64;
    let minimum = total.saturating_sub(weights[1]);
    let maximum = total.min(weights[0]);
    let layers = (floor - minimum).max(maximum - ceil);
    (0..=layers).map(move |distance| {
        let lower = floor.checked_sub(distance).filter(|&v| v >= minimum);
        let upper = ceil
            .checked_add(distance)
            .filter(|&v| v <= maximum && Some(v) != lower);
        [lower, upper]
    })
}

/// A complete result includes the best protected allocation, including zero action.
/// Exhausting the caller's candidate budget returns None and discards any partial best.
pub fn select(
    book: &Contest,
    venue: &[u8; 32],
    episode: u64,
    limit: u64,
) -> Result<Option<Selected>> {
    let ids = book.winner_ids();
    let preferred_winner = usize::from(
        (member_priority(venue, episode, ids[1]), ids[1])
            < (member_priority(venue, episode, ids[0]), ids[0]),
    );
    let weights = book.weights();
    // Only the target market takes a charge. Reuse the established sharing score
    // with zero weights and costs in its unused second column.
    let sharing_weights = weights.map(|weight| [weight, 0]);
    let upper = book.budget().min(weights[0].saturating_add(weights[1]));
    let mut examined = 0;
    let mut best: Option<(Allocation, Profile)> = None;
    'totals: for total in (0..=upper).rev() {
        // Actual impairment reduction is capped by the total concession. Include
        // equal totals because a different split can improve the later priorities.
        if best
            .as_ref()
            .is_some_and(|(plan, _)| plan.recovery > Amount::from_integer(total.into()))
        {
            break;
        }
        for layer in splits_by_deviation(total, weights) {
            let mut reached_ceiling = false;
            for left in layer.into_iter().flatten() {
                if examined == limit {
                    return Ok(None);
                }
                examined += 1;
                let charges = [left, total - left];
                let plan = match book.assess(charges) {
                    Ok(plan) => plan,
                    Err(Error::Entitlement) => continue,
                    Err(error) => return Err(error),
                };
                reached_ceiling |= plan.recovery == Amount::from_integer(total.into());
                let lots = plan.schedules.iter().map(|p| u128::from(p.matched)).sum();
                let profile = sharing(
                    &charges.map(|charge| [charge, 0]),
                    &sharing_weights,
                    [(u128::from(total), lots), (0, 0)],
                )?;
                let better = best.as_ref().is_none_or(|(prior, prior_profile)| {
                    plan.recovery
                        .cmp(&prior.recovery)
                        .then_with(|| prior_profile.deviation[0].compare(&profile.deviation[0]))
                        .then_with(|| prior_profile.cost[0].cmp(&profile.cost[0]))
                        .then_with(|| {
                            charges[preferred_winner].cmp(&prior.charges[preferred_winner])
                        })
                        == Ordering::Greater
                });
                if better {
                    best = Some((plan, profile));
                }
            }
            // Both neighboring splits have been tested, including any exact tie.
            // A later layer at this total cannot improve sharing, and smaller
            // charges cannot achieve this recovery, even with better foreign flows.
            if reached_ceiling {
                break 'totals;
            }
        }
    }
    let (allocation, _) = best.ok_or(Error::Invariant)?;
    Ok(Some(Selected {
        allocation,
        examined,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate alloc;
    use alloc::collections::BTreeSet;

    #[test]
    fn layers_cover_every_legal_split_before_any_worse_distance() {
        for first in 1..=12 {
            for second in 1..=12 {
                for total in 0..=first + second {
                    let mut seen = BTreeSet::new();
                    let mut previous = None;
                    for layer in splits_by_deviation(total, [first, second]) {
                        let mut furthest = 0;
                        for charge in layer.into_iter().flatten() {
                            assert!(seen.insert(charge));
                            let distance = (charge * second).abs_diff((total - charge) * first);
                            assert!(previous.is_none_or(|prior| prior < distance));
                            furthest = furthest.max(distance);
                        }
                        previous = Some(furthest);
                    }
                    assert_eq!(
                        seen,
                        (total.saturating_sub(second)..=total.min(first)).collect()
                    );
                }
            }
        }
        let max = u64::MAX;
        assert_eq!(
            splits_by_deviation(max, [max, max]).next(),
            Some([Some(max / 2), Some(max / 2 + 1)])
        );
        assert_eq!(
            splits_by_deviation(max, [max - 1, 1]).next(),
            Some([Some(max - 1), None])
        );
    }
}

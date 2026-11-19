//! Select the exact recovery when two one-lot debtors share two opposing lots.
use crate::{member_priority, single_lot::MemberAmount};
use core::cmp::Reverse;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pairing {
    /// Winner indices in canonical debtor order. A zero charge has no fill.
    pub winners: [usize; 2],
    pub charges: [u64; 2],
}

// Compare in protocol order. No score calculation squares a u64-scale amount.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct Score {
    recovery: u128,
    proportional_deviation: Reverse<u128>,
    lots_closed: Reverse<usize>,
    winner_charges: [u64; 2],
    paired_charges: [u64; 4],
}

impl Pairing {
    fn maximal(budgets: [u64; 2], capacities: [u64; 2], winners: [usize; 2]) -> Self {
        let charges =
            core::array::from_fn(|debtor| budgets[debtor].min(capacities[winners[debtor]]));
        Self { winners, charges }
    }

    fn score(
        &self,
        capacities: [u64; 2],
        winner_order: [usize; 2],
        debtor_order: [usize; 2],
    ) -> Score {
        let mut charges = [0; 2];
        for (debtor, &winner) in self.winners.iter().enumerate() {
            charges[winner] = self.charges[debtor];
        }
        // With total recovery fixed, both winners' deviations from their ideal
        // share have equal magnitude. Their common numerator is |q0*c1-q1*c0|.
        let deviation = (u128::from(charges[0]) * u128::from(capacities[1]))
            .abs_diff(u128::from(charges[1]) * u128::from(capacities[0]));
        let paired_charges = core::array::from_fn(|index| {
            let winner = winner_order[index / 2];
            let debtor = debtor_order[index % 2];
            if self.winners[debtor] == winner {
                self.charges[debtor]
            } else {
                0
            }
        });
        Score {
            recovery: u128::from(charges[0]) + u128::from(charges[1]),
            proportional_deviation: Reverse(deviation),
            lots_closed: Reverse(charges.iter().filter(|&&amount| amount > 0).count()),
            winner_charges: winner_order.map(|winner| charges[winner]),
            paired_charges,
        }
    }
}

pub fn assign(
    venue: &[u8; 32],
    epoch: u64,
    debtors: [MemberAmount; 2],
    winners: [MemberAmount; 2],
) -> Option<Pairing> {
    if debtors[0].id >= debtors[1].id
        || winners[0].id >= winners[1].id
        || debtors
            .iter()
            .any(|debtor| winners.iter().any(|winner| debtor.id == winner.id))
    {
        return None;
    }
    let priority_order = |members: [MemberAmount; 2]| {
        let keys = members.map(|member| (member_priority(venue, epoch, member.id), member.id));
        if keys[0] < keys[1] {
            [0, 1]
        } else {
            [1, 0]
        }
    };
    let budgets = debtors.map(|debtor| debtor.atoms);
    let capacities = winners.map(|winner| winner.atoms);
    let winner_order = priority_order(winners);
    let debtor_order = priority_order(debtors);
    // Every admissible matching with at most two edges extends to one of these
    // bijections. Within either, increasing an unsaturated charge strictly
    // increases recovered loss. The other edge consumes a distinct pair of lots.
    let first = Pairing::maximal(budgets, capacities, [0, 1]);
    let second = Pairing::maximal(budgets, capacities, [1, 0]);
    if second.score(capacities, winner_order, debtor_order)
        > first.score(capacities, winner_order, debtor_order)
    {
        Some(second)
    } else {
        Some(first)
    }
}

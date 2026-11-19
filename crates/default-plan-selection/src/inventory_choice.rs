//! Streaming proof that one pair uses the first feasible debtor in a frozen episode.
extern crate alloc;
use crate::member_priority;

#[derive(Clone, Copy, Debug)]
pub(crate) enum RemainingRole {
    Debtor(u64),
    Winner(u64),
    Other,
}

#[derive(Clone, Copy)]
pub(crate) struct Proposal {
    pub winner: u64,
    pub charge: u64,
    pub debtor: u64,
    /// A positive tight threshold can exclude an earlier, apparently eligible debtor.
    /// Zero means every earlier available debtor has insufficient budget.
    pub threshold: u64,
}

/// The caller authenticates each original member and its remaining role from the
/// same frozen episode. Every member, including paid and neutral members, must
/// be visited once in strictly increasing stable ID order.
#[derive(Clone, Default)]
pub(crate) struct ChoiceScan {
    pub cursor: u64,
    pub last_id: Option<u64>,
    pub debtors_above: u64,
    pub winners_above: u64,
    pub found_debtor: bool,
    pub found_winner: bool,
    pub earlier_debtor: bool,
    pub earlier_winner: bool,
}

pub(crate) struct Choice {
    proposal: Proposal,
    winner_order: ([u8; 32], u64),
    debtor_order: ([u8; 32], u64),
}

impl Choice {
    pub fn new(venue: &[u8; 32], epoch: u64, proposal: Proposal) -> Option<Self> {
        if proposal.charge == 0
            || proposal.winner == proposal.debtor
            || proposal.threshold != 0 && proposal.threshold <= proposal.charge
        {
            return None;
        }
        let order = |id| (member_priority(venue, epoch, id), id);
        Some(Self {
            proposal,
            winner_order: order(proposal.winner),
            debtor_order: order(proposal.debtor),
        })
    }

    /// The supplied rank must be the member's D121 hash from the authenticated freeze.
    pub fn observe(
        &self,
        scan: &mut ChoiceScan,
        id: u64,
        rank: [u8; 32],
        role: RemainingRole,
    ) -> Option<()> {
        if scan.last_id.is_some_and(|last| id <= last) {
            return None;
        }
        scan.cursor = scan.cursor.checked_add(1)?;
        scan.last_id = Some(id);
        let proposed = self.proposal;
        match role {
            RemainingRole::Debtor(budget) => {
                let meets_threshold = proposed.threshold > 0 && budget >= proposed.threshold;
                if meets_threshold {
                    scan.debtors_above = scan.debtors_above.checked_add(1)?;
                }
                if id == proposed.debtor {
                    scan.found_debtor = budget >= proposed.charge
                        && !meets_threshold
                        && (rank, id) == self.debtor_order;
                } else if budget >= proposed.charge
                    && !meets_threshold
                    && (rank, id) < self.debtor_order
                {
                    scan.earlier_debtor = true;
                }
            }
            RemainingRole::Winner(target) if target > 0 => {
                if proposed.threshold > 0 && target >= proposed.threshold {
                    scan.winners_above = scan.winners_above.checked_add(1)?;
                }
                if id == proposed.winner {
                    scan.found_winner =
                        target == proposed.charge && (rank, id) == self.winner_order;
                } else if (rank, id) < self.winner_order {
                    scan.earlier_winner = true;
                }
            }
            _ => {}
        }
        Some(())
    }

    pub fn verified(&self, scan: &ChoiceScan, count: u64) -> bool {
        scan.cursor == count
            && scan.found_debtor
            && scan.found_winner
            && !scan.earlier_debtor
            && !scan.earlier_winner
            && scan.debtors_above == scan.winners_above
    }
}

/// Verify a complete, feasible matching before examining any priority witness.
/// In particular, an earlier debtor might meet this winner's charge but be the
/// sole remaining source for another winner. A local priority scan by itself
/// does not prove the feasibility of consuming that debtor.
pub fn verify(
    venue: &[u8; 32],
    epoch: u64,
    debtors: &[crate::single_lot::MemberAmount],
    winners: &[crate::single_lot::MemberAmount],
    plan: &[crate::inventory_book::WitnessedPair],
) -> bool {
    use alloc::collections::BTreeMap;
    use alloc::vec::Vec;
    use core::cmp::Reverse;
    if [debtors, winners]
        .iter()
        .any(|members| members.windows(2).any(|pair| pair[0].id >= pair[1].id))
    {
        return false;
    }
    let mut members = BTreeMap::new();
    let mut budgets = Vec::with_capacity(debtors.len());
    for debtor in debtors {
        members.insert(
            debtor.id,
            (
                member_priority(venue, epoch, debtor.id),
                RemainingRole::Debtor(debtor.atoms),
            ),
        );
        budgets.push(debtor.atoms);
    }
    budgets.sort_unstable_by_key(|&budget| Reverse(budget));
    let mut ranked_winners: Vec<_> = winners
        .iter()
        .map(|winner| {
            (
                Reverse(winner.atoms),
                member_priority(venue, epoch, winner.id),
                winner.id,
            )
        })
        .collect();
    ranked_winners.sort_unstable();
    let mut required = 0;
    for (index, (Reverse(capacity), rank, id)) in ranked_winners.into_iter().enumerate() {
        let target = capacity.min(*budgets.get(index).unwrap_or(&0));
        required += usize::from(target > 0);
        if members
            .insert(id, (rank, RemainingRole::Winner(target)))
            .is_some()
        {
            return false;
        }
    }
    if plan.len() != required {
        return false;
    }
    let mut feasible = members.clone();
    for entry in plan {
        let pair = &entry.pair;
        let Some((_, RemainingRole::Winner(target))) = feasible.remove(&pair.winner) else {
            return false;
        };
        let Some((_, RemainingRole::Debtor(budget))) = feasible.remove(&pair.debtor) else {
            return false;
        };
        if pair.charge == 0 || pair.charge != target || pair.charge > budget {
            return false;
        }
    }
    // The same signed pair list must pass both passes. At every following
    // step its unprocessed suffix is already a witness of feasible completion.
    for entry in plan {
        let pair = &entry.pair;
        let proposal = Proposal {
            debtor: pair.debtor,
            winner: pair.winner,
            charge: pair.charge,
            threshold: entry.threshold,
        };
        let Some(choice) = Choice::new(venue, epoch, proposal) else {
            return false;
        };
        let mut scan = ChoiceScan::default();
        for (&id, &(rank, role)) in &members {
            if choice.observe(&mut scan, id, rank, role).is_none() {
                return false;
            }
        }
        if !choice.verified(&scan, members.len() as u64) {
            return false;
        }
        members.get_mut(&pair.debtor).unwrap().1 = RemainingRole::Other;
        members.get_mut(&pair.winner).unwrap().1 = RemainingRole::Other;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        inventory_book::{propose, WitnessedPair},
        single_lot::{Assignment, MemberAmount},
    };
    fn setup(equal: bool) -> ([MemberAmount; 2], [MemberAmount; 2]) {
        let make = |ids: [u64; 2], early: u64, late: u64| {
            let first = member_priority(&[0; 32], 1, ids[0]) < member_priority(&[0; 32], 1, ids[1]);
            [
                MemberAmount {
                    id: ids[0],
                    atoms: if first { early } else { late },
                },
                MemberAmount {
                    id: ids[1],
                    atoms: if first { late } else { early },
                },
            ]
        };
        (
            make([1, 8], 4, if equal { 4 } else { 1 }),
            make([3, 6], if equal { 4 } else { 1 }, 4),
        )
    }

    #[test]
    fn tight_threshold_preserves_the_only_larger_debtor() {
        let (debtors, winners) = setup(false);
        let mut steps = propose(&[0; 32], 1, &debtors, &winners).unwrap();
        assert_eq!((steps[0].pair.charge, steps[0].threshold), (1, 4));
        assert!(verify(&[0; 32], 1, &debtors, &winners, &steps));
        for bad_threshold in [0, 1, 5] {
            steps[0].threshold = bad_threshold;
            assert!(!verify(&[0; 32], 1, &debtors, &winners, &steps));
        }
        let first = steps[0].pair.debtor;
        steps[0].pair.debtor = steps[1].pair.debtor;
        steps[0].threshold = 0;
        steps[1].pair.debtor = first;
        // The earliest donor meets the small charge but its proposed suffix cannot pay four.
        assert!(!verify(&[0; 32], 1, &debtors, &winners, &steps));
    }

    #[test]
    fn complete_feasibility_does_not_replace_episode_order() {
        let (debtors, winners) = setup(true);
        let mut steps = propose(&[0; 32], 1, &debtors, &winners).unwrap();
        assert!(verify(&[0; 32], 1, &debtors, &winners, &steps));
        assert!(!verify(&[0; 32], 1, &debtors, &winners, &steps[..1]));
        steps.reverse();
        assert!(!verify(&[0; 32], 1, &debtors, &winners, &steps));
        steps.reverse();
        let first = steps[0].pair.debtor;
        steps[0].pair.debtor = steps[1].pair.debtor;
        assert!(!verify(&[0; 32], 1, &debtors, &winners, &steps));
        steps[1].pair.debtor = first;
        assert!(!verify(&[0; 32], 1, &debtors, &winners, &steps));
        assert!(!verify(
            &[0; 32],
            1,
            &debtors,
            &winners,
            &[WitnessedPair {
                pair: Assignment {
                    winner: 99,
                    debtor: first,
                    charge: 4
                },
                threshold: 0
            }]
        ));
    }
}

//! Complete single-market selection when each debtor and eligible winner has one lot.
//! The program adapter must authenticate the book, the budgets and surviving gains.
extern crate alloc;
use crate::{
    member_priority,
    single_lot::{Assignment, MemberAmount},
};
use alloc::vec::Vec;
use core::cmp::Reverse;

struct Member {
    id: u64,
    amount: u64,
    priority: ([u8; 32], u64),
}

fn ranked(venue: &[u8; 32], epoch: u64, members: &[MemberAmount]) -> Vec<Member> {
    let mut ranked: Vec<_> = members
        .iter()
        .filter(|member| member.atoms > 0)
        .map(|member| Member {
            id: member.id,
            amount: member.atoms,
            priority: (member_priority(venue, epoch, member.id), member.id),
        })
        .collect();
    ranked.sort_unstable_by_key(|member| (Reverse(member.amount), member.priority));
    ranked
}

struct Threshold {
    amount: u64,
    /// Unassigned debtors meeting this threshold, less winners still needing it.
    spare: usize,
}

pub fn assign(
    venue: &[u8; 32],
    epoch: u64,
    debtors: &[MemberAmount],
    winners: &[MemberAmount],
) -> Option<Vec<Assignment>> {
    let ordered = |members: &[MemberAmount]| {
        members
            .windows(2)
            .all(|adjacent| adjacent[0].id < adjacent[1].id)
    };
    if !ordered(debtors)
        || !ordered(winners)
        || debtors.iter().any(|debtor| {
            winners
                .binary_search_by_key(&debtor.id, |winner| winner.id)
                .is_ok()
        })
    {
        return None;
    }

    let budgets = ranked(venue, epoch, debtors);
    let capacities = ranked(venue, epoch, winners);
    // The assortative pairing maximizes sum(min(budget, capacity)). On tied
    // recovery, putting the larger unsaturated charge on the larger winning
    // capacity minimizes proportional deviation. Tied capacities use D121.
    let mut targets: Vec<_> = budgets
        .iter()
        .zip(&capacities)
        .map(|(debtor, winner)| (winner, debtor.amount.min(winner.amount)))
        .collect();
    let mut thresholds = Vec::new();
    for &(_, amount) in &targets {
        if thresholds
            .last()
            .is_some_and(|threshold: &Threshold| threshold.amount == amount)
        {
            continue;
        }
        let available = budgets.partition_point(|debtor| debtor.amount >= amount);
        let required = targets.partition_point(|(_, charge)| *charge >= amount);
        thresholds.push(Threshold {
            amount,
            spare: available.checked_sub(required)?,
        });
    }
    thresholds.reverse();
    targets.sort_unstable_by_key(|(winner, _)| winner.priority);
    let mut available: Vec<_> = budgets.iter().collect();
    available.sort_unstable_by_key(|debtor| debtor.priority);
    let mut pairs = Vec::with_capacity(targets.len());
    for (winner, charge) in targets {
        // Removing a budget b for this winner consumes one spare debtor
        // exactly at thresholds charge < t <= b. A tight threshold in this
        // interval would make a later winner's assigned charge impossible.
        let limit = thresholds
            .iter()
            .find(|threshold| threshold.amount > charge && threshold.spare == 0);
        let index = available.iter().position(|debtor| {
            debtor.amount >= charge
                && limit.is_none_or(|threshold| debtor.amount < threshold.amount)
        })?;
        let debtor = available.remove(index);
        for threshold in thresholds
            .iter_mut()
            .filter(|threshold| charge < threshold.amount && threshold.amount <= debtor.amount)
        {
            threshold.spare = threshold.spare.checked_sub(1)?;
        }
        pairs.push(Assignment {
            debtor: debtor.id,
            winner: winner.id,
            charge,
        });
    }
    Some(pairs)
}

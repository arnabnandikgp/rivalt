//! Exact single-market assignment when each participating debtor and winner
//! has one lot and all positive debtor budgets can be recovered in full.
extern crate alloc;
use crate::member_priority;
use alloc::vec::Vec;
use core::cmp::Reverse;

#[derive(Clone, Copy, Debug)]
pub struct MemberAmount {
    pub id: u64,
    /// Whole residual loss for a debtor, eligible gain for a winner.
    pub atoms: u64,
}

struct RankedMember {
    member: MemberAmount,
    priority: [u8; 32],
}

impl RankedMember {
    fn order(&self) -> ([u8; 32], u64) {
        (self.priority, self.member.id)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Assignment {
    pub debtor: u64,
    pub winner: u64,
    pub charge: u64,
}

fn canonical(members: &[MemberAmount]) -> bool {
    members.iter().all(|member| member.atoms > 0)
        && members.windows(2).all(|pair| pair[0].id < pair[1].id)
}

/// Inputs come from a complete freeze. The caller authenticates one opposing
/// lot per member, prices, per-lot capacity and the debtor's post-insurance
/// budget. A missing result leaves a different family to the general verifier.
pub fn assign(
    venue: &[u8; 32],
    epoch: u64,
    debtors: &[MemberAmount],
    winners: &[MemberAmount],
) -> Option<Vec<Assignment>> {
    if debtors.is_empty()
        || debtors.len() != winners.len()
        || !canonical(debtors)
        || !canonical(winners)
        || debtors.iter().any(|debtor| {
            winners
                .binary_search_by_key(&debtor.id, |winner| winner.id)
                .is_ok()
        })
    {
        return None;
    }
    let ranked = |members: &[MemberAmount]| {
        let mut ranked: Vec<_> = members
            .iter()
            .map(|&member| RankedMember {
                priority: member_priority(venue, epoch, member.id),
                member,
            })
            .collect();
        ranked.sort_unstable_by_key(|entry| (Reverse(entry.member.atoms), entry.order()));
        ranked
    };
    let budgets = ranked(debtors);
    let mut capacities = ranked(winners);
    // For fixed total charge, minimizing proportional deviation minimizes
    // sum(q²/capacity). Exchanging an inversion strictly lowers that sum when
    // both charges and capacities differ. Equal capacities award the larger
    // charge to the earlier frozen-episode winner.
    if budgets
        .iter()
        .zip(&capacities)
        .any(|(debtor, winner)| debtor.member.atoms > winner.member.atoms)
    {
        return None;
    }
    // Where charges tie, the winner's charge no longer depends on the pairing.
    // D121 assigns the earlier debtor to the earlier winner across that entire
    // band, including winners with unequal capacities.
    let mut start = 0;
    while start < budgets.len() {
        let count = budgets[start..]
            .partition_point(|item| item.member.atoms == budgets[start].member.atoms);
        capacities[start..start + count].sort_unstable_by_key(RankedMember::order);
        start += count;
    }
    Some(
        budgets
            .iter()
            .zip(capacities)
            .map(|(debtor, winner)| Assignment {
                debtor: debtor.member.id,
                winner: winner.member.id,
                charge: debtor.member.atoms,
            })
            .collect(),
    )
}

//! Frozen-episode default plan selection. The three-lot family below has two debtors.
//! Member IDs 0 and 1 are debtors, 2..=7 are winners and 8 is the flat creditor.
#![no_std]
use core::cmp::Ordering;
#[cfg(feature = "compact-book")]
pub mod compact_book;
pub mod foreign_creditor;
pub mod inventory_book;
pub mod inventory_choice;
#[cfg(any(feature = "sbf-joint-probe", all(feature = "native-joint", not(target_arch = "bpf"))))]
pub mod joint;
#[cfg(any(feature = "sbf-joint-probe", all(feature = "native-joint", not(target_arch = "bpf"))))]
pub mod joint_priority;
#[cfg(all(feature = "native-joint", not(target_arch = "bpf")))]
pub mod joint_search;
pub mod mirror;
pub mod pair_prefix;
#[cfg(feature = "native-search")]
pub mod multi_lot;
pub mod proportional;
pub mod single_lot;
pub mod two_debtors;

// Every unordered partition contains winner 0 in exactly one triple.
const PARTNERS: [(usize, usize); 10] = [
    (1, 2),
    (1, 3),
    (1, 4),
    (1, 5),
    (2, 3),
    (2, 4),
    (2, 5),
    (3, 4),
    (3, 5),
    (4, 5),
];
pub const PARTITIONS: u8 = PARTNERS.len() as u8;

pub fn valid_book(budget: u16, gains: &[u16; 6], cash: u16) -> bool {
    let budget = u32::from(budget);
    cash > 0
        && gains.iter().all(|&gain| {
            let gain = u32::from(gain);
            budget < 4 * gain && 2 * gain < budget
        })
        && gains.iter().map(|&gain| u32::from(gain)).sum::<u32>() == 2 * budget
}

/// D121 final ordering, shared by the native proposer and clearing.
pub fn member_priority(venue: &[u8], episode: u64, member: u64) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[
        b"Rivalt/frozen-member-order/v1\0",
        venue,
        &episode.to_le_bytes(),
        &member.to_le_bytes(),
    ])
    .to_bytes()
}

pub fn priorities(venue: &[u8], episode: u64) -> ([u8; 6], u8) {
    let hashes: [[u8; 32]; 8] =
        core::array::from_fn(|member| member_priority(venue, episode, member as u64));
    let mut winners = [0, 1, 2, 3, 4, 5];
    winners.sort_unstable_by_key(|&winner| (hashes[2 + winner as usize], winner));
    (winners, u8::from(hashes[1] < hashes[0]))
}

// With u16 gains this product is below 2^80. Multiplying by the squared
// charge and summing six terms stays below 2^115, including boundary books.
pub fn score_weights(gains: &[u16; 6]) -> [u128; 6] {
    core::array::from_fn(|index| {
        gains
            .iter()
            .enumerate()
            .filter(|(other, _)| *other != index)
            .map(|(_, &gain)| u128::from(gain))
            .product()
    })
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct Plan {
    pub charges: [u16; 6],
    /// Bit i is 1 exactly when winner i was assigned to debtor 1.
    pub debtor_mask: u8,
    pub recovered: u32,
    pub sharing_cost: u128,
}

impl Plan {
    pub fn beats(&self, other: &Self, order: &[u8; 6], preferred_debtor: u8) -> bool {
        self.recovered
            .cmp(&other.recovered)
            .then_with(|| other.sharing_cost.cmp(&self.sharing_cost))
            .then_with(|| {
                order
                    .iter()
                    .map(|&i| self.charges[i as usize])
                    .cmp(order.iter().map(|&i| other.charges[i as usize]))
            })
            .then_with(|| {
                let preference = |mask: u8, i: u8| ((mask >> i) & 1) == preferred_debtor;
                order
                    .iter()
                    .map(|&i| preference(self.debtor_mask, i))
                    .cmp(order.iter().map(|&i| preference(other.debtor_mask, i)))
            })
            == Ordering::Greater
    }
}

fn allocate(group: [usize; 3], budget: u16, gains: &[u16; 6], charges: &mut [u16; 6]) -> u32 {
    let capacity: u64 = group.iter().map(|&i| u64::from(gains[i])).sum();
    let target = capacity.min(u64::from(budget));
    let mut assigned = 0;
    for &i in &group {
        // Buy each marginal unit whose cost (2*q+1)/gain is strictly below
        // 2*target/capacity. Three nearest integers miss target by at most one.
        let quantity = (2 * target * u64::from(gains[i]) + capacity - 1) / (2 * capacity);
        charges[i] = quantity as u16;
        assigned += quantity;
    }
    if assigned != target {
        let add = assigned < target;
        let marginal = |i: usize| {
            if add {
                2 * u64::from(charges[i]) + 1
            } else {
                2 * u64::from(charges[i]) - 1
            }
        };
        let mut best = group[0];
        // The group is already ordered by episode priority. Add to the earlier
        // winner or remove from the later winner on an exact marginal tie.
        for &i in &group[1..] {
            let choice =
                (marginal(i) * u64::from(gains[best])).cmp(&(marginal(best) * u64::from(gains[i])));
            if (add && choice == Ordering::Less) || (!add && choice != Ordering::Less) {
                best = i;
            }
        }
        if add {
            charges[best] += 1;
        } else {
            charges[best] -= 1;
        }
    }
    target as u32
}

pub fn candidate(
    partition: u8,
    budget: u16,
    gains: &[u16; 6],
    weights: &[u128; 6],
    order: &[u8; 6],
    preferred_debtor: u8,
) -> Plan {
    let (second, third) = PARTNERS[usize::from(partition)];
    let mask = 1 | (1 << second) | (1 << third);
    let mut triples = [[0; 3]; 2];
    let mut lengths = [0; 2];
    for &winner in order {
        let group = usize::from(mask & (1 << winner) == 0);
        triples[group][lengths[group]] = usize::from(winner);
        lengths[group] += 1;
    }
    let mut plan = Plan::default();
    for triple in triples {
        plan.recovered += allocate(triple, budget, gains, &mut plan.charges);
    }
    for (winner, &charge) in plan.charges.iter().enumerate() {
        plan.sharing_cost += u128::from(charge).pow(2) * weights[winner];
    }
    // Both labels have the same economics. Give the highest-priority winner
    // its preferred debtor, exactly the first nonzero pair key under D121.
    plan.debtor_mask = if ((mask >> order[0]) & 1) == preferred_debtor {
        mask
    } else {
        mask ^ 0x3f
    };
    plan
}

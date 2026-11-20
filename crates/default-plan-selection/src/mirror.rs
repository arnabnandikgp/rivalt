//! D127 final comparison. The caller first verifies both plans, the complete
//! frozen cohort, and a tie on labelled recovery and insurance use. This kernel
//! checks a proposed economic reflection before applying D121 member priority.
//! Its inputs are computed from those verified records. A keeper supplies only
//! the proposed member permutation. A successful comparison alone cannot pay.
use crate::member_priority;
use core::cmp::Ordering;

/// Both types must compare exact financial values in a common or canonical
/// representation. Frozen terms include holdings, lot basis, gain and baseline
/// receipts. Outcome terms include effective claims, lots, exact and atom payouts.
pub struct Member<Frozen, Outcome> {
    pub id: u64,
    pub frozen: [Frozen; 2],
    pub outcomes: [[Outcome; 2]; 2],
    pub charges: [[u64; 2]; 2],
}

/// Ordered by (winner ordinal, market, debtor ordinal), with one positive
/// charge per distinct pair. Fills carry the execution quantities and prices.
#[derive(Clone, Copy)]
pub struct Pair<Fills> {
    pub market: u8,
    pub debtor: usize,
    pub winner: usize,
    pub charge: u64,
    pub fills: Fills,
}

impl<Fills> Pair<Fills> {
    fn key(&self) -> (usize, u8, usize) {
        (self.winner, self.market, self.debtor)
    }
}

/// Market inputs include frozen terms, buckets and ordinary rates. Market
/// outcomes include rates, recovery, insurance, fairness and closure costs.
pub struct Markets<Frozen, Outcome, Recovery> {
    pub frozen: [Frozen; 2],
    pub outcomes: [[Outcome; 2]; 2],
    pub recovery_and_insurance: [[Recovery; 2]; 2],
}

fn earliest<Key: Ord>(current: &mut Option<(Key, Ordering)>, key: Key, comparison: Ordering) {
    if !comparison.is_eq() && current.as_ref().is_none_or(|(previous, _)| key < *previous) {
        *current = Some((key, comparison));
    }
}

/// Return the preference for plan zero versus plan one. The full involution
/// check proves both uniqueness and complete membership without a visited set.
pub fn compare<F: Eq, R: Eq, M: Eq, S: Eq, E: Eq, T: Eq>(
    venue: &[u8; 32],
    episode: u64,
    markets: &Markets<M, S, E>,
    members: &[Member<F, R>],
    mirror: &[usize],
    pairs: [&[Pair<T>]; 2],
) -> Option<Ordering> {
    if members.is_empty()
        || members.len() != mirror.len()
        || markets.recovery_and_insurance[0] != markets.recovery_and_insurance[1]
        || markets.recovery_and_insurance[0][0] != markets.recovery_and_insurance[0][1]
        || markets.frozen[0] != markets.frozen[1]
        || (0..2).any(|m| markets.outcomes[0][m] != markets.outcomes[1][1 - m])
        || pairs[0].len() != pairs[1].len()
    {
        return None;
    }
    let rank = |ordinal: usize| {
        let id = members[ordinal].id;
        (member_priority(venue, episode, id), id)
    };
    let mut winner_order = None;
    for (index, member) in members.iter().enumerate() {
        let other = *mirror.get(index)?;
        let peer = members.get(other)?;
        if mirror[other] != index || (index > 0 && members[index - 1].id >= member.id) {
            return None;
        }
        for market in 0..2 {
            if member.frozen[market] != peer.frozen[1 - market]
                || member.outcomes[0][market] != peer.outcomes[1][1 - market]
                || member.charges[0][market] != peer.charges[1][1 - market]
            {
                return None;
            }
        }
        let order = member.charges[0].cmp(&member.charges[1]);
        if !order.is_eq() {
            earliest(&mut winner_order, rank(index), order);
        }
    }

    for rows in pairs {
        if rows.windows(2).any(|pair| pair[0].key() >= pair[1].key())
            || rows.iter().any(|pair| {
                pair.market > 1
                    || pair.winner >= members.len()
                    || pair.debtor >= members.len()
                    || pair.debtor == pair.winner
                    || pair.charge == 0
            })
        {
            return None;
        }
    }
    for (side, rows) in pairs.iter().enumerate() {
        let mut remaining = *rows;
        for (index, member) in members.iter().enumerate() {
            let mut charged = [0u64; 2];
            while let Some((pair, rest)) = remaining.split_first() {
                if pair.winner != index {
                    break;
                }
                let total = &mut charged[usize::from(pair.market)];
                *total = total.checked_add(pair.charge)?;
                remaining = rest;
            }
            if charged != member.charges[side] {
                return None;
            }
        }
    }
    for pair in pairs[0] {
        let reflected = (mirror[pair.winner], 1 - pair.market, mirror[pair.debtor]);
        let peer = &pairs[1][pairs[1].binary_search_by_key(&reflected, Pair::key).ok()?];
        if pair.charge != peer.charge || pair.fills != peer.fills {
            return None;
        }
    }
    if let Some((_, comparison)) = winner_order {
        return Some(comparison);
    }
    let mut pair_order = None;
    for (side, rows) in pairs.iter().enumerate() {
        for pair in *rows {
            let other = pairs[1 - side]
                .binary_search_by_key(&pair.key(), Pair::key)
                .map_or(0, |index| pairs[1 - side][index].charge);
            let order = if side == 0 {
                pair.charge.cmp(&other)
            } else {
                other.cmp(&pair.charge)
            };
            if !order.is_eq() {
                earliest(
                    &mut pair_order,
                    (rank(pair.winner), pair.market, rank(pair.debtor)),
                    order,
                );
            }
        }
    }
    Some(pair_order.map_or(Ordering::Equal, |(_, order)| order))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Two debtors have identical BTC/ETH exposure and two winners each get
    // one charge per market. Only the assignment to individual debtors differs.
    fn edge(winner: usize, market: u8, debtor: usize) -> Pair<(u64, u64)> {
        Pair {
            winner,
            market,
            debtor,
            charge: 1,
            fills: (1, 99),
        }
    }

    #[test]
    fn complete_pair_schedule_and_market_labels_are_required() {
        let mut rows: [_; 4] = core::array::from_fn(|i| Member {
            id: [2, 9, 27, 41][i],
            frozen: [i; 2],
            outcomes: [[i; 2]; 2],
            charges: if i < 2 { [[0; 2]; 2] } else { [[1; 2]; 2] },
        });
        let left = [edge(2, 0, 0), edge(2, 1, 1), edge(3, 0, 1), edge(3, 1, 0)];
        let mut right = [edge(2, 0, 1), edge(2, 1, 0), edge(3, 0, 0), edge(3, 1, 1)];
        let mut markets = Markets {
            frozen: [0; 2],
            outcomes: [[0; 2]; 2],
            recovery_and_insurance: [[(1, 0); 2]; 2],
        };
        let witness = [0, 1, 2, 3];
        // Hashes ordered independently using Python hashlib for these stable IDs.
        let selected = compare(&[0; 32], 1, &markets, &rows, &witness, [&left, &right]).unwrap();
        // Member 27 leads the winners; its BTC charge from debtor 9 is in the right plan.
        assert_eq!(selected, Ordering::Less);
        assert_eq!(
            compare(&[0; 32], 1, &markets, &rows, &witness, [&right, &left]),
            Some(selected.reverse())
        );
        assert!(compare(&[0; 32], 1, &markets, &rows, &[0, 1, 2, 9], [&left, &right]).is_none());
        markets.recovery_and_insurance[0][0].0 = 2;
        assert!(compare(&[0; 32], 1, &markets, &rows, &witness, [&left, &right]).is_none());
        markets.recovery_and_insurance[0][0].0 = 1;
        rows[2].charges = [[2; 2]; 2];
        assert!(compare(&[0; 32], 1, &markets, &rows, &witness, [&left, &right]).is_none());
        rows[2].charges = [[1; 2]; 2];
        right[0].fills = (1, 98);
        assert!(compare(&[0; 32], 1, &markets, &rows, &witness, [&left, &right]).is_none());
        right[0] = right[1];
        assert!(compare(&[0; 32], 1, &markets, &rows, &witness, [&left, &right]).is_none());
    }
}

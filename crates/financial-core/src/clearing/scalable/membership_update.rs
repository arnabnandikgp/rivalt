//! Bounded atomic changes to the financial-member radix index. The adapter must
//! authenticate every node/page PDA and forbid mutation while safety is frozen.
//! This planner grants no account, money or retirement authority.
use crate::{Error, Result};

pub const INDEX_LEVELS: usize = 15;
pub const ENTRIES_PER_PAGE: u64 = 64;
const MAX_PAGE: u64 = u64::MAX / ENTRIES_PER_PAGE;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NodeAddress {
    pub level: u8,
    pub prefix: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NodeSummary {
    pub populated_mask: u16,
    pub counts: [u64; 16],
}
impl NodeSummary {
    pub fn total(self, address: NodeAddress) -> Result<u64> {
        if address.level >= INDEX_LEVELS as u8
            || address.prefix > MAX_PAGE >> (4 * (u32::from(address.level) + 1))
        {
            return Err(Error::Bounds);
        }
        let mut total = 0u64;
        let mut mask = 0u16;
        for (slot, count) in self.counts.into_iter().enumerate() {
            total = total.checked_add(count).ok_or(Error::Overflow)?;
            if count == 0 {
                continue;
            }
            let child = address
                .prefix
                .checked_mul(16)
                .and_then(|prefix| prefix.checked_add(slot as u64))
                .ok_or(Error::Overflow)?;
            if child > MAX_PAGE >> (4 * u32::from(address.level))
                || (address.level == 0 && count > ENTRIES_PER_PAGE)
            {
                return Err(Error::Bounds);
            }
            mask |= 1 << slot;
        }
        if mask != self.populated_mask {
            return Err(Error::Cohort);
        }
        Ok(total)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Enter,
    Leave,
}
impl Change {
    fn count(self, before: u64) -> Result<u64> {
        match self {
            Self::Enter => before.checked_add(1),
            Self::Leave => before.checked_sub(1),
        }
        .ok_or(Error::Overflow)
    }
}

/// Only the selected child changes at each level. All updates are prepared before
/// the adapter commits any account; an invalid ancestor cannot leave a changed leaf.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PathUpdate {
    pub financial_mask: u64,
    pub financial_count: u64,
    pub child_counts: [u64; INDEX_LEVELS],
    pub populated_masks: [u16; INDEX_LEVELS],
}

pub fn address(member_id: u64, level: u8) -> Result<(NodeAddress, usize)> {
    if level >= INDEX_LEVELS as u8 {
        return Err(Error::Bounds);
    }
    let page = member_id / ENTRIES_PER_PAGE;
    let shift = 4 * u32::from(level);
    Ok((
        NodeAddress {
            level,
            prefix: page >> (shift + 4),
        },
        ((page >> shift) & 15) as usize,
    ))
}

/// Prove all fifteen predecessor counts bottom-up and the complete root total.
/// Ordinary financial mutations never call this: an already indexed member stays
/// Financial until an explicit, independently checked empty-account deactivation.
pub fn prepare(
    member_id: u64,
    financial_mask: u64,
    financial_count: u64,
    change: Change,
    mut read: impl FnMut(NodeAddress) -> Result<NodeSummary>,
) -> Result<PathUpdate> {
    let member_bit = 1u64 << (member_id % ENTRIES_PER_PAGE);
    let present = financial_mask & member_bit != 0;
    if present != (change == Change::Leave) {
        return Err(Error::Cohort);
    }
    let mut result = PathUpdate {
        financial_mask: financial_mask ^ member_bit,
        financial_count: change.count(financial_count)?,
        child_counts: [0; INDEX_LEVELS],
        populated_masks: [0; INDEX_LEVELS],
    };
    let mut expected_child = u64::from(financial_mask.count_ones());
    for level in 0..INDEX_LEVELS as u8 {
        let (node_address, slot) = address(member_id, level)?;
        let node = read(node_address)?;
        let total = node.total(node_address)?;
        if node.counts[slot] != expected_child {
            return Err(Error::Cohort);
        }
        let next = change.count(expected_child)?;
        result.child_counts[usize::from(level)] = next;
        result.populated_masks[usize::from(level)] = if next == 0 {
            node.populated_mask & !(1 << slot)
        } else {
            node.populated_mask | (1 << slot)
        };
        expected_child = total;
    }
    if expected_child != financial_count {
        return Err(Error::Cohort);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};
    type Nodes = BTreeMap<(u8, u64), NodeSummary>;

    // Independent reconstruction uses base-16 divisions of every enumerated ID,
    // not the planner's address/count outputs or traversal implementation.
    fn reconstruct(members: &BTreeSet<u64>) -> Nodes {
        let mut nodes = Nodes::new();
        for member in members {
            let mut child = member / 64;
            for level in 0..15 {
                let slot = (child % 16) as usize;
                child /= 16;
                let node = nodes.entry((level, child)).or_default();
                node.counts[slot] += 1;
                node.populated_mask |= 1 << slot;
            }
        }
        nodes
    }
    fn mask(members: &BTreeSet<u64>, id: u64) -> u64 {
        members
            .iter()
            .filter(|other| **other / 64 == id / 64)
            .fold(0, |bits, other| bits | (1 << (other % 64)))
    }
    #[test]
    fn complete_counts_match_independent_sparse_population_under_churn() {
        let ids: Vec<_> = (0..1_024)
            .map(|index| index * 67)
            .chain([1u64 << 32, 1u64 << 53, u64::MAX - 1])
            .collect();
        let mut members = BTreeSet::new();
        let mut nodes = Nodes::new();
        for (change, sequence) in [
            (Change::Enter, ids.clone()),
            (Change::Leave, ids.iter().rev().copied().collect()),
        ] {
            for id in sequence {
                let next = prepare(
                    id,
                    mask(&members, id),
                    members.len() as u64,
                    change,
                    |key| {
                        Ok(nodes
                            .get(&(key.level, key.prefix))
                            .copied()
                            .unwrap_or_default())
                    },
                )
                .unwrap();
                for level in 0..15 {
                    let (key, slot) = address(id, level).unwrap();
                    let node = nodes.entry((key.level, key.prefix)).or_default();
                    node.counts[slot] = next.child_counts[level as usize];
                    node.populated_mask = next.populated_masks[level as usize];
                }
                match change {
                    Change::Enter => {
                        assert!(members.insert(id));
                    }
                    Change::Leave => {
                        assert!(members.remove(&id));
                    }
                }
                assert_eq!(next.financial_count, members.len() as u64);
                assert_eq!(next.financial_mask, mask(&members, id));
                nodes.retain(|_, node| node.populated_mask != 0);
                assert_eq!(nodes, reconstruct(&members));
            }
        }
        assert!(nodes.is_empty());
    }
    #[test]
    fn replay_corrupt_ancestor_and_unreachable_child_reject_without_mutation() {
        let members = BTreeSet::from([0, 63, 64, 1u64 << 53]);
        let nodes = reconstruct(&members);
        for id in &members {
            assert_eq!(
                prepare(*id, mask(&members, *id), 4, Change::Enter, |key| Ok(
                    nodes[&(key.level, key.prefix)]
                )),
                Err(Error::Cohort)
            );
        }
        for broken in 0..15 {
            let frozen = nodes.clone();
            assert!(prepare(1, mask(&members, 1), 4, Change::Enter, |key| {
                let mut node = nodes[&(key.level, key.prefix)];
                if key.level == broken {
                    node.counts[0] += 1;
                }
                Ok(node)
            })
            .is_err());
            assert_eq!(nodes, frozen);
        }
        let mut node = NodeSummary::default();
        node.counts[4] = 1;
        node.populated_mask = 1 << 4;
        assert_eq!(
            node.total(NodeAddress {
                level: 14,
                prefix: 0
            }),
            Err(Error::Bounds)
        );
        assert!(prepare(7, 0, u64::MAX, Change::Enter, |_| panic!(
            "overflow before read"
        ))
        .is_err());
        assert!(prepare(7, 0, 0, Change::Leave, |_| panic!("absent before read")).is_err());
    }
}

//! Independently enumerated stable IDs vs the bounded index traversal. This
//! checks traversal and encoded restarts, not program ownership or freeze locks.
use financial_core::clearing::scalable::membership::{MembershipCursor, Request};
use std::collections::{BTreeMap, BTreeSet};

struct Index {
    nodes: BTreeMap<(u8, u64), [u64; 16]>,
    pages: BTreeMap<u64, u64>,
}
fn index(ids: &[u64]) -> Index {
    let mut nodes: BTreeMap<(u8, u64), [u64; 16]> = BTreeMap::new();
    let mut pages = BTreeMap::new();
    for id in ids {
        let page = id / 64;
        *pages.entry(page).or_insert(0) |= 1u64 << (id % 64);
        for level in 0..15 {
            let divisor = 16u64.pow(level);
            let child = page / divisor;
            nodes.entry((level as u8, child / 16)).or_insert([0; 16])[(child % 16) as usize] += 1;
        }
    }
    Index { nodes, pages }
}
fn mask(counts: &[u64; 16]) -> u16 {
    counts.iter().enumerate().fold(0, |mask, (index, count)| {
        mask | (u16::from(*count != 0) << index)
    })
}

#[test]
fn complete_sparse_and_dense_enumeration_restores_every_prefix() {
    let mut populations = vec![
        vec![0],
        vec![u64::MAX],
        vec![0, 63, 64, 1023, 1024, u64::MAX],
    ];
    for count in [64, 128, 1024, 10000] {
        populations.push((0..count).collect());
        // Sparse, non-contiguous pages cover all 58 bits. Sorting/uniqueness is
        // an independent linear expected list, never a traversal-generated one.
        populations.push(
            (0..count)
                .map(|id| id * 1_000_000_000_003)
                .chain([u64::MAX - 1, u64::MAX])
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
        );
    }
    for ids in populations {
        let frozen = index(&ids);
        let mut cursor = MembershipCursor::new(ids.len() as u64).unwrap();
        let mut observed = Vec::new();
        let mut calls = 0;
        loop {
            let bytes = cursor.checkpoint();
            cursor = MembershipCursor::from_checkpoint(&bytes, ids.len() as u64).unwrap();
            assert_eq!(bytes, cursor.checkpoint());
            calls += 1;
            match cursor.request() {
                Request::Node {
                    level,
                    prefix,
                    count,
                } => {
                    let children = frozen.nodes[&(level, prefix)];
                    assert_eq!(children.iter().sum::<u64>(), count);
                    cursor.node(mask(&children), children).unwrap();
                }
                Request::Page { index, count } => {
                    let financial = frozen.pages[&index];
                    assert_eq!(financial.count_ones(), u32::from(count));
                    cursor.page(financial).unwrap();
                }
                Request::Member { ordinal, id } => {
                    assert_eq!(ordinal as usize, observed.len());
                    assert_eq!(id, ids[observed.len()]);
                    observed.push(id);
                    cursor.member(id).unwrap();
                }
                Request::Done => break,
            }
        }
        assert_eq!(observed, ids);
        // Each internal edge is descended/returned once, each leaf page visited
        // once and every member accepted once. Root completion adds one call.
        assert_eq!(
            calls,
            2 * frozen.nodes.len() + 2 * frozen.pages.len() + ids.len()
        );
        assert!(cursor.node(0, [0; 16]).is_err());
        assert!(cursor.page(0).is_err());
        assert!(cursor.member(0).is_err());
    }
}

#[test]
fn missing_duplicate_foreign_order_count_and_checkpoint_errors_refuse() {
    assert!(MembershipCursor::new(0).is_err());
    let ids = [0, 63, 64, u64::MAX];
    let frozen = index(&ids);
    let mut cursor = MembershipCursor::new(4).unwrap();
    let mut stages = 0u8;
    loop {
        let before = cursor.checkpoint();
        stages |= 1 << before[2];
        assert!(MembershipCursor::from_checkpoint(&before, 5).is_err());
        assert!(MembershipCursor::from_checkpoint(&before[..543], 4).is_err());
        for (offset, value) in [
            (0, 9),
            (1, 15),
            (2, 9),
            (4, 1),
            (40, 1),
            (63, 1),
            (89, 1),
            (543, 1),
        ] {
            let mut corrupt = before;
            corrupt[offset] = value;
            assert!(
                MembershipCursor::from_checkpoint(&corrupt, 4).is_err(),
                "offset {offset}"
            );
        }
        let mut corrupt = before;
        corrupt[16..24].copy_from_slice(&5u64.to_le_bytes());
        assert!(MembershipCursor::from_checkpoint(&corrupt, 4).is_err());
        match cursor.request() {
            Request::Node { level, prefix, .. } => {
                assert!(cursor.page(1).is_err());
                assert!(cursor.member(0).is_err());
                let counts = frozen.nodes[&(level, prefix)];
                assert!(cursor.node(mask(&counts) ^ 1, counts).is_err());
                let mut incomplete = counts;
                let nonempty = incomplete.iter().position(|value| *value != 0).unwrap();
                incomplete[nonempty] -= 1;
                assert!(cursor.node(mask(&incomplete), incomplete).is_err());
                assert_eq!(cursor.checkpoint(), before);
                cursor.node(mask(&counts), counts).unwrap();
            }
            Request::Page { index, .. } => {
                assert!(cursor.node(0, [0; 16]).is_err());
                assert!(cursor.member(index * 64).is_err());
                let financial = frozen.pages[&index];
                assert!(cursor.page(financial & (financial - 1)).is_err());
                assert_eq!(cursor.checkpoint(), before);
                cursor.page(financial).unwrap();
            }
            Request::Member { id, .. } => {
                assert!(cursor.node(0, [0; 16]).is_err());
                assert!(cursor.page(1).is_err());
                assert!(cursor.member(id ^ 1).is_err());
                assert_eq!(cursor.checkpoint(), before);
                cursor.member(id).unwrap();
                assert!(cursor.member(id).is_err());
            }
            Request::Done => break,
        }
    }
    assert_eq!(stages, 0b1111);
    // Root branches 4..15 lie beyond the u64 member-ID namespace.
    let mut cursor = MembershipCursor::new(1).unwrap();
    let mut foreign = [0; 16];
    foreign[4] = 1;
    assert!(cursor.node(1 << 4, foreign).is_err());
    let mut overflowing = [0; 16];
    overflowing[0] = u64::MAX;
    overflowing[1] = 1;
    assert!(cursor.node(3, overflowing).is_err());
}

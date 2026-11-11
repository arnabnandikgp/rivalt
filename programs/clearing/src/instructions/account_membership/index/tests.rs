use super::*;
use crate::test_support::TestAccount;

fn path(venue: Address, id: u64) -> Vec<TestAccount> {
    (0..15)
        .map(|level| {
            // Independent path construction from repeated base-16 division.
            let page = id / 64;
            let prefix = page / 16u64.pow(u32::from(level) + 1);
            let (key, bump) = find_program_address(
                &[
                    b"member-index",
                    venue.as_ref(),
                    &[level],
                    &prefix.to_le_bytes(),
                ],
                &crate::ID,
            );
            let mut bytes = MemberIndexNode::DISCRIMINATOR.to_vec();
            bytes.extend_from_slice(&10u16.to_le_bytes());
            bytes.extend_from_slice(&7u64.to_le_bytes());
            bytes.extend_from_slice(venue.as_ref());
            bytes.push(level);
            bytes.extend_from_slice(&prefix.to_le_bytes());
            bytes.resize(189, 0);
            bytes.push(bump);
            TestAccount::new(key, crate::ID, &bytes, true, false)
        })
        .collect()
}
#[test]
fn authenticated_full_width_path_enters_leaves_and_preserves_revision_ownership() {
    for id in [0, 63, 64, 1u64 << 53, u64::MAX - 1] {
        let venue = Address::new_unique();
        let mut storage = path(venue, id);
        let mut views: Vec<_> = storage.iter_mut().map(TestAccount::view).collect();
        let original: Vec<_> = views
            .iter()
            .map(|account| account.try_borrow().unwrap().to_vec())
            .collect();
        let entered = prepare(&views, &venue, id, 0, 0, Change::Enter, [7; 15]).unwrap();
        commit(&mut views, id, entered).unwrap();
        assert_eq!(entered.financial_count, 1);
        for view in &views {
            assert_eq!(&view.try_borrow().unwrap()[10..18], &7u64.to_le_bytes());
        }
        assert!(prepare(
            &views,
            &venue,
            id,
            entered.financial_mask,
            1,
            Change::Enter,
            [7; 15]
        )
        .is_err());
        let left = prepare(
            &views,
            &venue,
            id,
            entered.financial_mask,
            1,
            Change::Leave,
            [7; 15],
        )
        .unwrap();
        commit(&mut views, id, left).unwrap();
        assert_eq!(left.financial_count, 0);
        assert_eq!(
            views
                .iter()
                .map(|account| account.try_borrow().unwrap().to_vec())
                .collect::<Vec<_>>(),
            original
        );
    }
}
#[test]
fn path_refuses_alias_order_foreign_owner_stale_revision_and_last_ancestor_corruption() {
    let venue = Address::new_unique();
    let mut storage = path(venue, 64);
    let mut views: Vec<_> = storage.iter_mut().map(TestAccount::view).collect();
    assert!(prepare(&views[..14], &venue, 64, 0, 0, Change::Enter, [7; 15]).is_err());
    assert!(prepare(
        &views,
        &Address::new_unique(),
        64,
        0,
        0,
        Change::Enter,
        [7; 15]
    )
    .is_err());
    assert!(prepare(&views, &venue, 64, 0, 0, Change::Enter, [8; 15]).is_err());
    for level in 0..15 {
        let mut substituted = views.clone();
        substituted[level] = views[(level + 1) % 15].clone();
        assert!(prepare(&substituted, &venue, 64, 0, 0, Change::Enter, [7; 15]).is_err());
    }
    for (owner, writable, executable) in [
        (Address::new_unique(), true, false),
        (crate::ID, false, false),
        (crate::ID, true, true),
    ] {
        let bytes = views[14].try_borrow().unwrap().to_vec();
        let mut bad = TestAccount::new(*views[14].address(), owner, &bytes, writable, executable);
        let mut substituted = views.clone();
        substituted[14] = bad.view();
        assert!(prepare(&substituted, &venue, 64, 0, 0, Change::Enter, [7; 15]).is_err());
    }
    views[14].try_borrow_mut().unwrap()[61] = 1;
    let before: Vec<_> = views
        .iter()
        .map(|account| account.try_borrow().unwrap().to_vec())
        .collect();
    assert!(prepare(&views, &venue, 64, 0, 0, Change::Enter, [7; 15]).is_err());
    assert_eq!(
        views
            .iter()
            .map(|account| account.try_borrow().unwrap().to_vec())
            .collect::<Vec<_>>(),
        before
    );
}

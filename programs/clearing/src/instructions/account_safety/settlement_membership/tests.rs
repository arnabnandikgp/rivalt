use super::*;
use crate::test_support::TestAccount;
use anchor_lang::AccountDeserialize;

fn common(name: &[u8], venue: Address) -> Vec<u8> {
    let mut bytes = solana_sha256_hasher::hash(name).to_bytes()[..8].to_vec();
    bytes.extend_from_slice(&9u16.to_le_bytes());
    bytes.extend_from_slice(&7u64.to_le_bytes());
    bytes.extend_from_slice(venue.as_ref());
    bytes
}
fn node(venue: Address, level: u8) -> (Address, Vec<u8>) {
    let (address, bump) = find_program_address(
        &[
            b"member-index",
            venue.as_ref(),
            &[level],
            &0u64.to_le_bytes(),
        ],
        &crate::ID,
    );
    let mut bytes = common(b"account:MemberIndexNode", venue);
    bytes.push(level);
    bytes.extend_from_slice(&0u64.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&2u64.to_le_bytes());
    bytes.resize(189, 0);
    bytes.push(bump);
    (address, bytes)
}
fn page(venue: Address) -> (Address, Vec<u8>) {
    let (address, bump) = find_program_address(
        &[b"member-page", venue.as_ref(), &0u64.to_le_bytes()],
        &crate::ID,
    );
    let mut bytes = common(b"account:MemberPage", venue);
    bytes.extend_from_slice(&0u64.to_le_bytes());
    bytes.extend_from_slice(&(1u64 | (1 << 63)).to_le_bytes());
    bytes.extend_from_slice(&(1u64 | (1 << 63)).to_le_bytes());
    bytes.resize(2698, 0);
    for (slot, key) in [(0, 11), (63, 22)] {
        let start = 74 + slot * 41;
        bytes[start..start + 32].fill(key);
        bytes[start + 32] = 2;
        bytes[start + 33..start + 41].copy_from_slice(&7u64.to_le_bytes());
    }
    bytes.push(bump);
    (address, bytes)
}
fn at_page(venue: Address) -> MembershipCursor {
    let mut cursor = MembershipCursor::new(2).unwrap();
    for level in (0..15).rev() {
        let (address, bytes) = node(venue, level);
        let mut backing = TestAccount::new(address, crate::ID, &bytes, false, false);
        advance_node(&mut cursor, &venue, &backing.view()).unwrap();
    }
    assert_eq!(cursor.request(), Request::Page { index: 0, count: 2 });
    cursor
}
#[test]
fn literal_membership_layouts_and_complete_native_loader_traversal() {
    let venue = Address::new_unique();
    let (_, bytes) = node(venue, 14);
    let decoded = MemberIndexNode::try_deserialize(&mut bytes.as_slice()).unwrap();
    let mut encoded = Vec::new();
    crate::wire::write_discriminated(&decoded, &mut encoded).unwrap();
    assert_eq!(encoded, bytes);
    assert_eq!(8 + MemberIndexNode::INIT_SPACE, 190);
    let (address, bytes) = page(venue);
    let decoded = MemberPage::try_deserialize(&mut bytes.as_slice()).unwrap();
    encoded.clear();
    crate::wire::write_discriminated(&decoded, &mut encoded).unwrap();
    assert_eq!(encoded, bytes);
    assert_eq!(8 + MemberPage::INIT_SPACE, 2699);
    assert_eq!(
        decoded.members.entries[63].root,
        Address::new_from_array([22; 32])
    );
    let mut cursor = at_page(venue);
    let mut backing = TestAccount::new(address, crate::ID, &bytes, false, false);
    let view = backing.view();
    advance_page(&mut cursor, &venue, &view).unwrap();
    for (ordinal, id, key) in [(0, 0, 11), (1, 63, 22)] {
        assert_eq!(cursor.request(), Request::Member { ordinal, id });
        let entry = financial_member(&cursor, &venue, &view).unwrap();
        assert_eq!(entry.root, Address::new_from_array([key; 32]));
        assert_eq!(entry.activation_generation, 7);
        cursor.member(id).unwrap();
    }
    for level in 0..15 {
        let (address, bytes) = node(venue, level);
        let mut backing = TestAccount::new(address, crate::ID, &bytes, false, false);
        advance_node(&mut cursor, &venue, &backing.view()).unwrap();
    }
    assert_eq!(cursor.request(), Request::Done);
}
#[test]
fn node_loader_refuses_wrong_identity_count_mask_owner_or_order() {
    let venue = Address::new_unique();
    let (address, bytes) = node(venue, 14);
    let check = |data: &[u8], key, owner| {
        let mut backing = TestAccount::new(key, owner, data, false, false);
        let mut cursor = MembershipCursor::new(2).unwrap();
        let before = cursor.checkpoint();
        let result = advance_node(&mut cursor, &venue, &backing.view());
        if result.is_err() {
            assert_eq!(cursor.checkpoint(), before);
        }
        result.is_ok()
    };
    assert!(check(&bytes, address, crate::ID));
    // Revision is owned by the frozen-epoch controller; it is not guessed here.
    for offset in (0..10).chain(18..190) {
        let mut corrupt = bytes.clone();
        corrupt[offset] ^= 1;
        assert!(!check(&corrupt, address, crate::ID), "offset {offset}");
    }
    assert!(!check(&bytes, Address::new_unique(), crate::ID));
    assert!(!check(&bytes, address, Address::new_unique()));
    assert!(!check(&bytes[..189], address, crate::ID));
    let (wrong, other) = node(venue, 13);
    assert!(!check(&other, wrong, crate::ID));
}
#[test]
fn page_and_entry_loader_refuse_foreign_unallocated_or_inactive_members() {
    let venue = Address::new_unique();
    let (address, bytes) = page(venue);
    let before = at_page(venue);
    let check = |data: &[u8], key, owner| {
        let mut backing = TestAccount::new(key, owner, data, false, false);
        let mut cursor = before.clone();
        let result = advance_page(&mut cursor, &venue, &backing.view());
        if result.is_err() {
            assert_eq!(cursor.checkpoint(), before.checkpoint());
        }
        result.is_ok()
    };
    for offset in (0..10).chain(18..58).chain(66..74).chain([2698]) {
        let mut corrupt = bytes.clone();
        corrupt[offset] ^= 1;
        assert!(!check(&corrupt, address, crate::ID), "offset {offset}");
    }
    let mut unallocated = bytes.clone();
    unallocated[58] = 0;
    assert!(!check(&unallocated, address, crate::ID));
    assert!(!check(&bytes, Address::new_unique(), crate::ID));
    assert!(!check(&bytes, address, Address::new_unique()));
    assert!(!check(&bytes[..2698], address, crate::ID));
    let mut cursor = before;
    cursor.page(1 | (1 << 63)).unwrap();
    for field in 0..3 {
        let mut corrupt = bytes.clone();
        match field {
            0 => corrupt[74..106].fill(0),
            1 => corrupt[106] = 1,
            _ => corrupt[107..115].fill(0),
        };
        let mut backing = TestAccount::new(address, crate::ID, &corrupt, false, false);
        assert!(financial_member(&cursor, &venue, &backing.view()).is_err());
    }
}

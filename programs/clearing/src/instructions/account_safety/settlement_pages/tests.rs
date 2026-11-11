use super::*;
use crate::{state::accounts::*, test_support::TestAccount};
use anchor_lang::AccountDeserialize;
use financial_core::clearing::scalable::wide::{Cursor, Operation};

fn page(venue: Address, register: u32, index: u64, words: u16) -> (Address, Vec<u8>) {
    let (address, bump) = find_program_address(
        &[
            b"resolution-limbs",
            venue.as_ref(),
            &19u64.to_le_bytes(),
            &register.to_le_bytes(),
            &index.to_le_bytes(),
        ],
        &crate::ID,
    );
    let mut bytes =
        solana_sha256_hasher::hash(b"account:SettlementLimbPage").to_bytes()[..8].to_vec();
    bytes.extend_from_slice(&9u16.to_le_bytes());
    bytes.extend_from_slice(&11u64.to_le_bytes());
    bytes.extend_from_slice(venue.as_ref());
    bytes.extend_from_slice(&19u64.to_le_bytes());
    bytes.extend_from_slice(&23u64.to_le_bytes());
    bytes.extend_from_slice(&register.to_le_bytes());
    bytes.extend_from_slice(&index.to_le_bytes());
    bytes.extend_from_slice(&words.to_le_bytes());
    bytes.push(bump);
    assert_eq!(bytes.len(), 81);
    bytes.resize(2129, 0);
    (address, bytes)
}
fn one_plan(writable: bool) -> PagePlan {
    PagePlan::next(
        [
            Some(WordAccess {
                register: 7,
                limb: 256,
                writable,
            }),
            None,
            None,
        ],
        257,
    )
    .unwrap()
}
fn versions(count: usize) -> Vec<PageVersion> {
    vec![
        PageVersion {
            attempt: 23,
            revision: 11
        };
        count
    ]
}

#[test]
fn literal_page_encoding_matches_account_type_and_direct_word_offsets() {
    let venue = Address::new_unique();
    let (_, mut bytes) = page(venue, 7, 1, 1);
    bytes[81..89].copy_from_slice(&42u64.to_le_bytes());
    let decoded = SettlementLimbPage::try_deserialize(&mut bytes.as_slice()).unwrap();
    assert_eq!(decoded.payload.words[0], 42);
    assert_eq!(decoded.schema_version, 9);
    assert_eq!(decoded.venue, venue);
    assert_eq!(decoded.register, 7);
    assert_eq!(decoded.page_index, 1);
    assert_eq!(decoded.word_count, 1);
    let mut encoded = Vec::new();
    crate::wire::write_discriminated(&decoded, &mut encoded).unwrap();
    assert_eq!(encoded, bytes);
    assert_eq!(8 + SettlementLimbPage::INIT_SPACE, 2129);
    assert_eq!(LIMB_PAGE_BYTES, 2129);
    assert_eq!(LIMB_WORDS_OFFSET, 81);
}

#[test]
fn page_binding_rejects_every_wrong_prefix_byte_and_foreign_accounts() {
    let venue = Address::new_unique();
    let (address, bytes) = page(venue, 7, 1, 1);
    let check = |data: &[u8], key, owner, writable, executable| {
        let mut backing = TestAccount::new(key, owner, data, writable, executable);
        let mut views = [backing.view()];
        PageWindow::load(&venue, 19, one_plan(true), &versions(1), &mut views).is_ok()
    };
    assert!(check(&bytes, address, crate::ID, true, false));
    for offset in 0..81 {
        let mut corrupt = bytes.clone();
        corrupt[offset] ^= 1;
        assert!(
            !check(&corrupt, address, crate::ID, true, false),
            "unchecked prefix byte {offset}"
        );
    }
    assert!(!check(
        &bytes,
        Address::new_unique(),
        crate::ID,
        true,
        false
    ));
    assert!(!check(&bytes, address, Address::new_unique(), true, false));
    assert!(!check(&bytes, address, crate::ID, false, false));
    assert!(!check(&bytes, address, crate::ID, true, true));
    assert!(!check(&bytes[..2128], address, crate::ID, true, false));
    let mut backing = TestAccount::new(address, crate::ID, &bytes, true, false);
    let mut views = [backing.view()];
    let mut window =
        PageWindow::load(&venue, 19, one_plan(false), &versions(1), &mut views).unwrap();
    assert!(window.write(7, 256, 5).is_err());
    assert!(window.read(7, 257).is_err());
    assert!(window.read(8, 256).is_err());
    assert!(PageWindow::load(&venue, 20, one_plan(false), &versions(1), &mut views).is_err());
    assert!(PageWindow::load(
        &venue,
        19,
        one_plan(false),
        &[PageVersion {
            attempt: 24,
            revision: 11
        }],
        &mut views
    )
    .is_err());
    assert!(PageWindow::load(
        &venue,
        19,
        one_plan(false),
        &[PageVersion {
            attempt: 23,
            revision: 12
        }],
        &mut views
    )
    .is_err());
    assert!(PageWindow::load(&venue, 19, one_plan(false), &versions(1), &mut []).is_err());
    assert!(PageWindow::load(
        &venue,
        19,
        one_plan(false),
        &versions(2),
        &mut [views[0].clone(), views[0].clone()]
    )
    .is_err());
}

#[test]
fn exact_addition_suspends_before_page_boundary_and_commits_only_output_revision() {
    let venue = Address::new_unique();
    let mut cursor = Cursor::new(Operation::Add, 257, 0, 1, 2).unwrap();
    for index in 0..2u64 {
        let mut backing: Vec<TestAccount> = (0..3)
            .map(|register| {
                let (address, mut bytes) =
                    page(venue, register, index, if index == 0 { 256 } else { 1 });
                if index == 0 && register < 2 {
                    bytes[81..89]
                        .copy_from_slice(&(if register == 0 { 7u64 } else { 9u64 }).to_le_bytes());
                    let value = if register == 0 { u64::MAX } else { 1 };
                    bytes[81 + 255 * 8..89 + 255 * 8].copy_from_slice(&value.to_le_bytes());
                }
                TestAccount::new(address, crate::ID, &bytes, register == 2, false)
            })
            .collect();
        let mut views: Vec<_> = backing.iter_mut().map(TestAccount::view).collect();
        let plan = PagePlan::next(cursor.accesses().unwrap(), 257).unwrap();
        let mut window = PageWindow::load(&venue, 19, plan, &versions(3), &mut views).unwrap();
        let mut steps = 0;
        while !cursor.is_done() && window.covers(cursor.accesses().unwrap()) {
            cursor.step(&mut window).unwrap();
            cursor = Cursor::from_checkpoint(&cursor.checkpoint(), 257).unwrap();
            steps += 1;
        }
        assert_eq!(steps, if index == 0 { 256 } else { 1 });
        window.commit().unwrap();
        for (register, view) in views.iter().enumerate() {
            let data = view.try_borrow().unwrap();
            assert_eq!(
                u64::from_le_bytes(data[10..18].try_into().unwrap()),
                if register == 2 { 12 } else { 11 }
            );
        }
        let output = views[2].try_borrow().unwrap();
        assert_eq!(
            u64::from_le_bytes(output[81..89].try_into().unwrap()),
            if index == 0 { 16 } else { 1 }
        );
        if index == 0 {
            assert_eq!(&output[81 + 255 * 8..89 + 255 * 8], &[0; 8]);
        }
    }
    assert!(cursor.is_done());
}

#[test]
fn page_revision_exhaustion_rejects_before_writes_and_committed_replay_is_stale() {
    let venue = Address::new_unique();
    let (address, mut bytes) = page(venue, 7, 1, 1);
    bytes[10..18].copy_from_slice(&u64::MAX.to_le_bytes());
    let mut backing = TestAccount::new(address, crate::ID, &bytes, true, false);
    let mut views = [backing.view()];
    let exhausted = [PageVersion {
        attempt: 23,
        revision: u64::MAX,
    }];
    assert!(PageWindow::load(&venue, 19, one_plan(true), &exhausted, &mut views).is_err());
    PageWindow::load(&venue, 19, one_plan(false), &exhausted, &mut views)
        .unwrap()
        .commit()
        .unwrap();
    assert_eq!(&*views[0].try_borrow().unwrap(), bytes.as_slice());

    bytes[10..18].copy_from_slice(&11u64.to_le_bytes());
    let mut backing = TestAccount::new(address, crate::ID, &bytes, true, false);
    let mut views = [backing.view()];
    let mut window =
        PageWindow::load(&venue, 19, one_plan(true), &versions(1), &mut views).unwrap();
    window.write(7, 256, 41).unwrap();
    window.commit().unwrap();
    assert!(PageWindow::load(&venue, 19, one_plan(true), &versions(1), &mut views).is_err());
    let committed = [PageVersion {
        attempt: 23,
        revision: 12,
    }];
    let window = PageWindow::load(&venue, 19, one_plan(false), &committed, &mut views).unwrap();
    assert_eq!(window.read(7, 256).unwrap(), 41);
}

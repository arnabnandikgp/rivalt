use super::*;
use anchor_lang::AccountDeserialize;
use anchor_lang::Event;

#[test]
fn manual_storage_creation_requires_system_empty_then_exact_owned_new_layout() {
    use crate::test_support::TestAccount;
    let key = Address::new_unique();
    let mut empty = TestAccount::new(key, anchor_lang::system_program::ID, &[], true, false);
    empty.view().set_lamports(37); // a prior donation must not block creation
    let mut bytes = vec![0; 8 + PreparedSettlement::INIT_SPACE];
    bytes[..8].copy_from_slice(PreparedSettlement::DISCRIMINATOR);
    bytes[8..10].copy_from_slice(&10u16.to_le_bytes());
    for (owner, size, schema, revision) in [
        (crate::ID, bytes.len(), 10, 0),
        (anchor_lang::system_program::ID, bytes.len(), 10, 0),
        (crate::ID, bytes.len() - 1, 10, 0),
        (crate::ID, bytes.len(), 8, 0),
        (crate::ID, bytes.len(), 10, 1),
    ] {
        let mut scope = Scope::new();
        scope
            .created_raw::<PreparedSettlement>(&mut empty.view())
            .unwrap();
        let mut candidate = bytes[..size].to_vec();
        candidate[8..10].copy_from_slice(&(schema as u16).to_le_bytes());
        candidate[10..18].copy_from_slice(&(revision as u64).to_le_bytes());
        let mut initialized = TestAccount::new(key, owner, &candidate, true, false);
        let mut account = initialized.view();
        scope.cursor = Some(0);
        let result = scope.created_raw::<PreparedSettlement>(&mut account);
        if owner == crate::ID && size == bytes.len() && schema == 10 && revision == 0 {
            result.unwrap();
            assert_eq!(&account.try_borrow().unwrap()[10..18], &1u64.to_le_bytes());
            assert_eq!(
                owned(
                    &scope
                        .finish(Address::default(), [0; 32], [0; 8], 0, 1)
                        .unwrap()
                )
                .writes[0]
                    .kind,
                17
            );
        } else {
            assert!(result.is_err());
        }
    }
    let mut already_owned = TestAccount::new(key, crate::ID, &bytes, true, false);
    assert!(Scope::new()
        .created_raw::<PreparedSettlement>(&mut already_owned.view())
        .is_err());
}

fn with_margin(
    value: MarginAccount,
    writable: bool,
    test: impl FnOnce(&mut BorshAccount<MarginAccount>),
) {
    let key = Address::new_unique();
    let mut bytes = Vec::new();
    crate::wire::write_discriminated(&value, &mut bytes).unwrap();
    let mut backing =
        crate::test_support::TestAccount::new(key, crate::ID, &bytes, writable, false);
    let mut info = backing.view();
    let mut account = unsafe { BorshAccount::<MarginAccount>::load_mut(info.clone()) }.unwrap();
    test(&mut account);
}

#[test]
fn declared_read_stays_read_when_message_promotes_key_to_writable() {
    with_margin(
        MarginAccount {
            schema_version: SCHEMA_VERSION,
            revision: 19,
            cash: 100,
            ..Default::default()
        },
        true,
        |account| {
            let mut scope = Scope::new();
            scope.account(account, Access::Read).unwrap();
            scope.cursor = Some(0);
            scope.account(account, Access::Read).unwrap();
            assert_eq!(account.revision, 19);
            assert_eq!(account.cash, 100);
            // A readonly-only context cannot claim to be a financial transition.
            assert!(scope
                .finish(Address::default(), [0; 32], [0; 8], 0, 42)
                .is_err());
        },
    );
}

#[test]
fn creation_and_noop_writer_advance_once_after_the_handler() {
    with_margin(MarginAccount::default(), true, |account| {
        let mut scope = Scope::new();
        scope.account(account, Access::Create).unwrap();
        assert_eq!(account.revision, 0);
        account.schema_version = SCHEMA_VERSION;
        account.cash = 17; // initializer's effect
        scope.cursor = Some(0);
        scope.account(account, Access::Create).unwrap();
        let event = scope
            .finish(Address::default(), [0; 32], [1; 8], 0, 42)
            .unwrap();
        assert_eq!(
            owned(&event).writes,
            vec![ScopedWrite {
                account: account.address().to_owned(),
                kind: 5,
                before: 0,
                after: 1
            }]
        );
        assert_eq!((account.revision, account.cash), (1, 17));
        let mut next = Scope::new();
        next.account(account, Access::Write).unwrap();
        next.cursor = Some(0);
        next.account(account, Access::Write).unwrap();
        assert_eq!((account.revision, account.cash), (2, 17));
        assert!(next.account(account, Access::Write).is_err());
    });
}

#[test]
fn duplicate_missing_reset_wrong_schema_and_exhaustion_fail_closed() {
    let key = Address::new_unique();
    let mut scope = Scope::new();
    scope
        .visit(key, 5, SCHEMA_VERSION, 8, Access::Write)
        .unwrap();
    assert!(scope
        .visit(key, 5, SCHEMA_VERSION, 8, Access::Read)
        .is_err());
    scope.cursor = Some(0);
    assert!(scope
        .visit(key, 5, SCHEMA_VERSION, 0, Access::Write)
        .is_err());
    assert!(scope.visit(key, 5, 3, 8, Access::Write).is_err());
    assert!(scope
        .visit(key, 5, SCHEMA_VERSION, 8, Access::Read)
        .is_err());
    assert!(scope
        .finish(Address::default(), [0; 32], [0; 8], 1, 42)
        .is_err());
    for (schema, revision, access) in [
        (3, 8, Access::Read),
        (SCHEMA_VERSION, 0, Access::Write),
        (SCHEMA_VERSION, u64::MAX, Access::Write),
        (SCHEMA_VERSION, 0, Access::Create),
    ] {
        assert!(Scope::new()
            .visit(key, 5, schema, revision, access)
            .is_err());
    }
    // A terminal revision is still a valid read; only its next mutation is blocked.
    assert!(Scope::new()
        .visit(key, 5, SCHEMA_VERSION, u64::MAX, Access::Read)
        .is_ok());
}

#[test]
fn remaining_root_preserves_manual_financial_write_then_advances_header() {
    let key = Address::new_unique();
    let mut root = MarginAccount {
        schema_version: SCHEMA_VERSION,
        revision: 11,
        cash: 100,
        ..Default::default()
    };
    let mut bytes = Vec::new();
    crate::wire::write_discriminated(&root, &mut bytes).unwrap();
    let mut backing = crate::test_support::TestAccount::new(key, crate::ID, &bytes, true, false);
    let mut info = backing.view();
    let mut scope = Scope::new();
    scope
        .remaining(std::slice::from_mut(&mut info), true)
        .unwrap();
    root.cash = 37; // independently fixed simulated handler result, not liquidation evidence
    crate::wire::write_account(&root, &mut info.try_borrow_mut().unwrap()[..]).unwrap();
    scope.cursor = Some(0);
    scope
        .remaining(std::slice::from_mut(&mut info), true)
        .unwrap();
    let actual = MarginAccount::try_deserialize(&mut &info.try_borrow().unwrap()[..]).unwrap();
    assert_eq!((actual.cash, actual.revision), (37, 12));
    let mut expected = Vec::new();
    root.revision = 12;
    crate::wire::write_discriminated(&root, &mut expected).unwrap();
    assert_eq!(&info.try_borrow().unwrap()[..], expected);
    let event = scope
        .finish(Address::default(), [0; 32], [0; 8], 1, 42)
        .unwrap();
    assert_eq!(owned(&event).writes[0].before, 11);
    assert_eq!(owned(&event).writes[0].after, 12);
    let mut duplicate = Scope::new();
    duplicate
        .visit(key, 5, SCHEMA_VERSION, 12, Access::Read)
        .unwrap();
    assert!(duplicate
        .remaining(std::slice::from_mut(&mut info), false)
        .is_err());
    // A readonly remaining root may be promoted by the message without advancing.
    let mut readonly = Scope::new();
    readonly
        .remaining(std::slice::from_mut(&mut info), false)
        .unwrap();
    readonly.cursor = Some(0);
    readonly
        .remaining(std::slice::from_mut(&mut info), false)
        .unwrap();
    assert_eq!(&info.try_borrow().unwrap()[..], expected);
}

#[test]
fn envelope_has_literal_field_offsets_and_bounded_entity_count() {
    let event = AccountTransition {
        schema_version: SCHEMA_VERSION,
        venue: Address::new_from_array([7; 32]),
        domain: [9; 32],
        slot: 42,
        instruction: [11; 8],
        payload_count: 2,
        reads: vec![ScopedRead {
            account: Address::new_from_array([13; 32]),
            kind: 6,
            revision: 17,
        }],
        writes: vec![ScopedWrite {
            account: Address::new_from_array([19; 32]),
            kind: 5,
            before: 23,
            after: 24,
        }],
    };
    let bytes = event.data();
    assert_eq!(bytes.len(), 190); // 100 + one 41-byte read + one 49-byte write
    assert_eq!(&bytes[8..10], &[10, 0]);
    assert_eq!(&bytes[10..42], &[7; 32]);
    assert_eq!(&bytes[42..74], &[9; 32]);
    assert_eq!(&bytes[74..82], &42u64.to_le_bytes());
    assert_eq!(&bytes[82..90], &[11; 8]);
    assert_eq!(&bytes[90..96], &[2, 0, 1, 0, 0, 0]);
    assert_eq!(bytes[128], 6);
    assert_eq!(&bytes[129..137], &17u64.to_le_bytes());
    assert_eq!(&bytes[137..141], &[1, 0, 0, 0]);
    assert_eq!(bytes[173], 5);
    assert_eq!(&bytes[174..182], &23u64.to_le_bytes());
    assert_eq!(&bytes[182..190], &24u64.to_le_bytes());
    let mut scope = Scope::new();
    for byte in 0..32 {
        scope
            .visit(
                Address::new_from_array([byte; 32]),
                5,
                SCHEMA_VERSION,
                1,
                Access::Write,
            )
            .unwrap();
    }
    assert!(scope
        .visit(
            Address::new_from_array([32; 32]),
            5,
            SCHEMA_VERSION,
            1,
            Access::Write
        )
        .is_err());
}

#[test]
fn canonical_account_headers_bind_kind_schema_revision_and_canonical_discriminator() {
    fn check<
        T: Revisioned
            + SchemaWrite<anchor_lang::BorshConfig, Src = T>
            + Discriminator
            + AccountDeserialize,
    >(
        name: &str,
        kind: u8,
        size: usize,
    ) {
        let hash = solana_sha256_hasher::hash(format!("account:{name}").as_bytes()).to_bytes();
        assert_eq!(T::DISCRIMINATOR, &hash[..8]);
        assert_eq!(T::KIND, kind);
        // Decode an independently laid-out fixed zero body (empty registry Vec),
        // then verify the common revision header at its frozen byte offset.
        let mut bytes = vec![0; size];
        bytes[..8].copy_from_slice(&hash[..8]);
        bytes[8..10].copy_from_slice(&SCHEMA_VERSION.to_le_bytes());
        bytes[10..18].copy_from_slice(&0x0807_0605_0403_0201u64.to_le_bytes());
        let value = T::try_deserialize(&mut bytes.as_slice()).unwrap();
        assert_eq!(value.schema(), SCHEMA_VERSION);
        assert_eq!(value.revision(), 0x0807_0605_0403_0201);
        let mut actual = Vec::new();
        crate::wire::write_discriminated(&value, &mut actual).unwrap();
        assert_eq!(&actual[8..18], &[10, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
        bytes[..8].copy_from_slice(&[0; 8]);
        assert!(T::try_deserialize(&mut bytes.as_slice()).is_err());
    }
    check::<Venue>("Venue", 0, 329);
    check::<Custody>("Custody", 1, 59);
    check::<VenueSafety>("VenueSafety", 2, 85);
    check::<VenueRegistry>("VenueRegistry", 3, 115);
    check::<Portfolio>("Portfolio", 4, 91);
    check::<MarginAccount>("MarginAccount", 5, 1011);
    check::<Market>("Market", 6, 455);
    check::<MarketLedger>("MarketLedger", 7, 373);
    check::<CapitalBinding>("CapitalBinding", 8, 114);
    check::<SettlementCertificate>("SettlementCertificate", 9, 621);
    check::<Resolution>("Resolution", 10, 572);
    check::<RetirementCertificate>("RetirementCertificate", 13, 636);
    check::<LiquidityRegistry>("LiquidityRegistry", 14, 181);
    check::<MakerRegistration>("MakerRegistration", 15, 341);
    check::<FundingPublisher>("FundingPublisher", 16, 148);
}

fn owned(view: &TransitionView) -> AccountTransition {
    crate::wire::read::<AccountTransition>(&bytes(view)).unwrap()
}

#[test]
fn borrowed_footer_matches_owned_vectors_at_all_supported_sizes() {
    for count in 1..=MAX_ENTITIES {
        let mut scope = Scope::new();
        let mut reads = Vec::new();
        let mut writes = Vec::new();
        for index in 0..count {
            let account = Address::new_from_array([index as u8; 32]);
            let kind = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16][index % 15];
            let revision = index as u64 + 1;
            let access = if index % 3 == 0 {
                Access::Write
            } else {
                Access::Read
            };
            scope
                .visit(account, kind, SCHEMA_VERSION, revision, access)
                .unwrap();
            if access == Access::Read {
                reads.push(ScopedRead {
                    account,
                    kind,
                    revision,
                });
            } else {
                writes.push(ScopedWrite {
                    account,
                    kind,
                    before: revision,
                    after: revision + 1,
                });
            }
        }
        scope.cursor = Some(count);
        let venue = Address::new_from_array([77; 32]);
        let view = scope.finish(venue, [9; 32], [11; 8], 2, 42).unwrap();
        let expected = AccountTransition {
            schema_version: SCHEMA_VERSION,
            venue,
            domain: [9; 32],
            slot: 42,
            instruction: [11; 8],
            payload_count: 2,
            reads,
            writes,
        };
        assert_eq!(bytes(&view), bytes(&expected));
    }
}

fn bytes<T: SchemaWrite<anchor_lang::BorshConfig, Src = T>>(value: &T) -> Vec<u8> {
    let mut bytes = Vec::new();
    crate::wire::write(&value, &mut bytes).unwrap();
    bytes
}

#[test]
fn successor_schema_is_kind_bound_and_raw_page_writes_advance_once() {
    let key = Address::new_unique();
    for kind in 17..=23 {
        assert!(Scope::new().visit(key, kind, 8, 1, Access::Read).is_err());
        assert!(Scope::new().visit(key, kind, 10, 1, Access::Read).is_ok());
    }
    assert!(Scope::new().visit(key, 5, 8, 1, Access::Read).is_err());
    for kind in [11, 12, 28] {
        assert!(Scope::new().visit(key, kind, 10, 1, Access::Read).is_err());
    }
    let page = SettlementLimbPage {
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        revision: 11,
        ..Default::default()
    };
    let mut bytes = Vec::new();
    crate::wire::write_discriminated(&page, &mut bytes).unwrap();
    let mut backing = crate::test_support::TestAccount::new(key, crate::ID, &bytes, true, false);
    let mut view = backing.view();
    let mut read = Scope::new();
    read.raw::<SettlementLimbPage>(&mut view, Access::Read)
        .unwrap();
    read.cursor = Some(0);
    read.raw::<SettlementLimbPage>(&mut view, Access::Read)
        .unwrap();
    assert_eq!(view.try_borrow().unwrap()[10..18], 11u64.to_le_bytes());
    let mut write = Scope::new();
    write
        .raw::<SettlementLimbPage>(&mut view, Access::Write)
        .unwrap();
    view.try_borrow_mut().unwrap()[81..89].copy_from_slice(&17u64.to_le_bytes());
    write.cursor = Some(0);
    write
        .raw::<SettlementLimbPage>(&mut view, Access::Write)
        .unwrap();
    assert_eq!(view.try_borrow().unwrap()[10..18], 12u64.to_le_bytes());
    assert_eq!(view.try_borrow().unwrap()[81..89], 17u64.to_le_bytes());
    assert!(Scope::new()
        .raw::<MemberPage>(&mut view, Access::Read)
        .is_err());
}

#[test]
fn rate_work_creation_and_read_use_the_successor_schema_mapping() {
    let kind = <SettlementRates as Revisioned>::KIND;
    let key = Address::new_unique();
    let mut scope = Scope::new();
    assert_eq!(scope.visit(key, kind, 0, 0, Access::Create).unwrap(), 0);
    scope.cursor = Some(0);
    assert_eq!(
        scope
            .visit(key, kind, SETTLEMENT_SCHEMA, 0, Access::Create)
            .unwrap(),
        1
    );
    let mut read = Scope::new();
    assert_eq!(
        read.visit(key, kind, SETTLEMENT_SCHEMA, 1, Access::Read)
            .unwrap(),
        1
    );
    assert!(Scope::new().visit(key, kind, 8, 1, Access::Read).is_err());
    assert!(Scope::new()
        .visit(key, u8::MAX, 0, 0, Access::Create)
        .is_err());
}

#[test]
fn conserving_plan_creation_and_read_use_append_only_kind_23() {
    let kind = <SettlementPlan as Revisioned>::KIND;
    assert_eq!(kind, 23);
    let key = Address::new_unique();
    let mut scope = Scope::new();
    assert_eq!(scope.visit(key, kind, 0, 0, Access::Create).unwrap(), 0);
    scope.cursor = Some(0);
    assert_eq!(
        scope
            .visit(key, kind, SETTLEMENT_SCHEMA, 0, Access::Create)
            .unwrap(),
        1
    );
    assert_eq!(
        Scope::new()
            .visit(key, kind, SETTLEMENT_SCHEMA, 1, Access::Read)
            .unwrap(),
        1
    );
    assert!(Scope::new().visit(key, kind, 8, 1, Access::Read).is_err());
}

#[test]
fn permanent_tombstone_keeps_predecessor_revision_and_has_one_narrow_kind_transition() {
    use crate::test_support::TestAccount;
    let key = Address::new_unique();
    let root = MarginAccount {
        schema_version: SCHEMA_VERSION,
        revision: 77,
        lifecycle: MEMBER_REGISTERED,
        activation_generation: 9,
        ..Default::default()
    };
    let mut root_bytes = Vec::new();
    crate::wire::write_discriminated(&root, &mut root_bytes).unwrap();
    let mut before = TestAccount::new(key, crate::ID, &root_bytes, true, false);
    let tombstone = MarginTombstone {
        schema_version: SCHEMA_VERSION,
        revision: 77,
        activation_generation: 9,
        ..Default::default()
    };
    let mut tombstone_bytes = Vec::new();
    crate::wire::write_discriminated(&tombstone, &mut tombstone_bytes).unwrap();
    for mutation in 0..7 {
        let mut scope = Scope::new();
        scope.retire_margin(&mut before.view()).unwrap();
        let mut candidate = tombstone_bytes.clone();
        let (mut address, mut owner, mut writable) = (key, crate::ID, true);
        match mutation {
            0 => {}
            1 => candidate[10..18].copy_from_slice(&1u64.to_le_bytes()),
            2 => candidate[8] = 8,
            3 => candidate[..8].copy_from_slice(MarginAccount::DISCRIMINATOR),
            4 => address = Address::new_unique(),
            5 => owner = anchor_lang::system_program::ID,
            6 => writable = false,
            _ => unreachable!(),
        }
        let mut after = TestAccount::new(address, owner, &candidate, writable, false);
        scope.cursor = Some(0);
        let result = scope.retire_margin(&mut after.view());
        if mutation == 0 {
            result.unwrap();
            let event = owned(
                &scope
                    .finish(Address::default(), [0; 32], [0; 8], 1, 42)
                    .unwrap(),
            );
            assert_eq!(
                event.writes,
                vec![ScopedWrite {
                    account: key,
                    kind: 26,
                    before: 77,
                    after: 78
                }]
            );
            assert_eq!(
                &after.view().try_borrow().unwrap()[10..18],
                &78u64.to_le_bytes()
            );
        } else {
            assert!(result.is_err(), "mutation {mutation}");
        }
    }
    let mut tombstone = TestAccount::new(key, crate::ID, &tombstone_bytes, true, false);
    assert!(Scope::new().retire_margin(&mut tombstone.view()).is_err());
}

#[test]
fn terminal_storage_relabelling_is_limited_to_exact_recovery_shapes() {
    use crate::test_support::TestAccount;
    let key = Address::new_unique();
    for (kind, discriminator, space) in [
        (17, PreparedSettlement::DISCRIMINATOR, PreparedSettlement::INIT_SPACE),
        (18, FrozenMarginPage::DISCRIMINATOR, FrozenMarginPage::INIT_SPACE),
        (21, SettlementLimbPage::DISCRIMINATOR, SettlementLimbPage::INIT_SPACE),
        (22, SettlementRates::DISCRIMINATOR, SettlementRates::INIT_SPACE),
        (23, SettlementPlan::DISCRIMINATOR, SettlementPlan::INIT_SPACE),
    ] {
        let mut original = vec![0; 8 + space];
        original[..8].copy_from_slice(discriminator);
        original[8..10].copy_from_slice(&SETTLEMENT_SCHEMA.to_le_bytes());
        original[10..18].copy_from_slice(&91u64.to_le_bytes());
        let tombstone = StorageTombstone { schema_version: SETTLEMENT_SCHEMA, revision: 91,
            original_kind: kind, completed_epoch: 3, ..Default::default() };
        let mut expected = Vec::new();
        crate::wire::write_discriminated(&tombstone, &mut expected).unwrap();
        for mutation in 0..9 {
            let mut before = TestAccount::new(key, crate::ID, &original, true, false);
            let mut scope = Scope::new();
            scope.retire_storage(&mut before.view()).unwrap();
            let mut bytes = expected.clone();
            let (mut account_key, mut owner, mut writable) = (key, crate::ID, true);
            match mutation {
                0 => {},
                1 => bytes[10..18].copy_from_slice(&90u64.to_le_bytes()),
                2 => bytes[8] = 8,
                3 => bytes[50] = 5,
                4 => bytes[50] = if kind == 17 { 18 } else { 17 },
                5 => account_key = Address::new_unique(),
                6 => owner = anchor_lang::system_program::ID,
                7 => writable = false,
                8 => bytes.push(0),
                _ => unreachable!(),
            }
            let mut after = TestAccount::new(account_key, owner, &bytes, writable, false);
            scope.cursor = Some(0);
            let result = scope.retire_storage(&mut after.view());
            if mutation == 0 {
                result.unwrap();
                let event = owned(&scope.finish(Address::default(), [0; 32], [0; 8], 1, 42).unwrap());
                assert_eq!(event.writes, vec![ScopedWrite { account: key, kind: 27, before: 91, after: 92 }]);
            } else { assert!(result.is_err(), "kind {kind}, mutation {mutation}"); }
        }
        let mut retired = TestAccount::new(key, crate::ID, &expected, true, false);
        assert!(Scope::new().retire_storage(&mut retired.view()).is_err());
    }
    let mut member = vec![0; 8 + MemberPage::INIT_SPACE];
    member[..8].copy_from_slice(MemberPage::DISCRIMINATOR);
    let mut member = TestAccount::new(key, crate::ID, &member, true, false);
    assert!(Scope::new().retire_storage(&mut member.view()).is_err());
}

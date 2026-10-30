use super::*;
use anchor_lang::Event;

fn with_margin(
    value: MarginAccount,
    writable: bool,
    test: impl FnOnce(&mut Account<MarginAccount>),
) {
    let key = Pubkey::new_unique();
    let mut lamports = 1;
    let mut bytes = Vec::new();
    value.try_serialize(&mut bytes).unwrap();
    let info = AccountInfo::new(
        &key,
        false,
        writable,
        &mut lamports,
        &mut bytes,
        &crate::ID,
        false,
    );
    let mut account = Account::<MarginAccount>::try_from(&info).unwrap();
    test(&mut account);
}

#[test]
fn declared_read_stays_read_when_message_promotes_key_to_writable() {
    with_margin(
        MarginAccount {
            schema_version: 5,
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
                .finish(Pubkey::default(), [0; 32], [0; 8], 0, 42)
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
        account.schema_version = 5;
        account.cash = 17; // initializer's effect
        scope.cursor = Some(0);
        scope.account(account, Access::Create).unwrap();
        let event = scope
            .finish(Pubkey::default(), [0; 32], [1; 8], 0, 42)
            .unwrap();
        assert_eq!(
            owned(&event).writes,
            vec![ScopedWrite {
                account: account.key(),
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
    let key = Pubkey::new_unique();
    let mut scope = Scope::new();
    scope.visit(key, 5, 5, 8, Access::Write).unwrap();
    assert!(scope.visit(key, 5, 5, 8, Access::Read).is_err());
    scope.cursor = Some(0);
    assert!(scope.visit(key, 5, 5, 0, Access::Write).is_err());
    assert!(scope.visit(key, 5, 3, 8, Access::Write).is_err());
    assert!(scope.visit(key, 5, 5, 8, Access::Read).is_err());
    assert!(scope
        .finish(Pubkey::default(), [0; 32], [0; 8], 1, 42)
        .is_err());
    for (schema, revision, access) in [
        (3, 8, Access::Read),
        (5, 0, Access::Write),
        (5, u64::MAX, Access::Write),
        (5, 0, Access::Create),
    ] {
        assert!(Scope::new()
            .visit(key, 5, schema, revision, access)
            .is_err());
    }
    // A terminal revision is still a valid read; only its next mutation is blocked.
    assert!(Scope::new()
        .visit(key, 5, 5, u64::MAX, Access::Read)
        .is_ok());
}

#[test]
fn remaining_root_preserves_manual_financial_write_then_advances_header() {
    let key = Pubkey::new_unique();
    let mut lamports = 1;
    let mut root = MarginAccount {
        schema_version: 5,
        revision: 11,
        cash: 100,
        ..Default::default()
    };
    let mut bytes = Vec::new();
    root.try_serialize(&mut bytes).unwrap();
    let info = AccountInfo::new(
        &key,
        false,
        true,
        &mut lamports,
        &mut bytes,
        &crate::ID,
        false,
    );
    let mut scope = Scope::new();
    scope.remaining(std::slice::from_ref(&info), true).unwrap();
    root.cash = 37; // independently fixed simulated handler result, not liquidation evidence
    root.try_serialize(&mut &mut info.try_borrow_mut_data().unwrap()[..])
        .unwrap();
    scope.cursor = Some(0);
    scope.remaining(std::slice::from_ref(&info), true).unwrap();
    let actual = MarginAccount::try_deserialize(&mut &info.try_borrow_data().unwrap()[..]).unwrap();
    assert_eq!((actual.cash, actual.revision), (37, 12));
    let mut expected = Vec::new();
    root.revision = 12;
    root.try_serialize(&mut expected).unwrap();
    assert_eq!(&info.try_borrow_data().unwrap()[..], expected);
    let event = scope
        .finish(Pubkey::default(), [0; 32], [0; 8], 1, 42)
        .unwrap();
    assert_eq!(owned(&event).writes[0].before, 11);
    assert_eq!(owned(&event).writes[0].after, 12);
    let mut duplicate = Scope::new();
    duplicate.visit(key, 5, 5, 12, Access::Read).unwrap();
    assert!(duplicate
        .remaining(std::slice::from_ref(&info), false)
        .is_err());
    // A readonly remaining root may be promoted by the message without advancing.
    let mut readonly = Scope::new();
    readonly
        .remaining(std::slice::from_ref(&info), false)
        .unwrap();
    readonly.cursor = Some(0);
    readonly
        .remaining(std::slice::from_ref(&info), false)
        .unwrap();
    assert_eq!(&info.try_borrow_data().unwrap()[..], expected);
}

#[test]
fn envelope_has_literal_field_offsets_and_bounded_entity_count() {
    let event = AccountTransition {
        schema_version: 5,
        venue: Pubkey::new_from_array([7; 32]),
        domain: [9; 32],
        slot: 42,
        instruction: [11; 8],
        payload_count: 2,
        reads: vec![ScopedRead {
            account: Pubkey::new_from_array([13; 32]),
            kind: 6,
            revision: 17,
        }],
        writes: vec![ScopedWrite {
            account: Pubkey::new_from_array([19; 32]),
            kind: 5,
            before: 23,
            after: 24,
        }],
    };
    let bytes = event.data();
    assert_eq!(bytes.len(), 190); // 100 + one 41-byte read + one 49-byte write
    assert_eq!(&bytes[8..10], &[5, 0]);
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
            .visit(Pubkey::new_from_array([byte; 32]), 5, 5, 1, Access::Write)
            .unwrap();
    }
    assert!(scope
        .visit(Pubkey::new_from_array([32; 32]), 5, 5, 1, Access::Write)
        .is_err());
}

#[test]
fn all_seventeen_account_headers_bind_kind_schema_revision_and_canonical_discriminator() {
    fn check<T: Revisioned + AccountSerialize + AccountDeserialize + Discriminator>(
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
        bytes[8..10].copy_from_slice(&5u16.to_le_bytes());
        bytes[10..18].copy_from_slice(&0x0807_0605_0403_0201u64.to_le_bytes());
        let value = T::try_deserialize(&mut bytes.as_slice()).unwrap();
        assert_eq!(value.schema(), 5);
        assert_eq!(value.revision(), 0x0807_0605_0403_0201);
        let mut actual = Vec::new();
        value.try_serialize(&mut actual).unwrap();
        assert_eq!(&actual[8..18], &[5, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
        bytes[..8].copy_from_slice(&[0; 8]);
        assert!(T::try_deserialize(&mut bytes.as_slice()).is_err());
    }
    check::<Venue>("Venue", 0, 329);
    check::<Custody>("Custody", 1, 83);
    check::<VenueSafety>("VenueSafety", 2, 85);
    check::<VenueRegistry>("VenueRegistry", 3, 2113);
    check::<Portfolio>("Portfolio", 4, 87);
    check::<MarginAccount>("MarginAccount", 5, 978);
    check::<Market>("Market", 6, 455);
    check::<MarketLedger>("MarketLedger", 7, 117);
    check::<CapitalBinding>("CapitalBinding", 8, 114);
    check::<SettlementCertificate>("SettlementCertificate", 9, 242);
    check::<Resolution>("Resolution", 10, 3652);
    check::<ResolutionPage>("ResolutionPage", 11, 3408);
    check::<ResolutionWork>("ResolutionWork", 12, 7926);
    check::<RetirementCertificate>("RetirementCertificate", 13, 80);
    check::<LiquidityRegistry>("LiquidityRegistry", 14, 181);
    check::<MakerRegistration>("MakerRegistration", 15, 341);
    check::<FundingPublisher>("FundingPublisher", 16, 148);
}


fn owned(view: &TransitionView<'_>) -> AccountTransition {
    AccountTransition::deserialize(&mut bytes(view).as_slice()).unwrap()
}

#[test]
fn borrowed_footer_matches_owned_vectors_at_all_supported_sizes() {
    for count in 1..=MAX_ENTITIES {
        let mut scope = Scope::new();
        let mut reads = Vec::new();
        let mut writes = Vec::new();
        for index in 0..count {
            let account = Pubkey::new_from_array([index as u8; 32]);
            let kind = (index % 17) as u8;
            let revision = index as u64 + 1;
            let access = if index % 3 == 0 { Access::Write } else { Access::Read };
            scope.visit(account, kind, SCHEMA_VERSION, revision, access).unwrap();
            if access == Access::Read { reads.push(ScopedRead { account, kind, revision }); }
            else { writes.push(ScopedWrite { account, kind, before: revision, after: revision + 1 }); }
        }
        scope.cursor = Some(count);
        let venue = Pubkey::new_from_array([77; 32]);
        let view = scope.finish(venue, [9; 32], [11; 8], 2, 42).unwrap();
        let expected = AccountTransition { schema_version: SCHEMA_VERSION, venue,
            domain: [9; 32], slot: 42, instruction: [11; 8], payload_count: 2, reads, writes };
        assert_eq!(bytes(&view), bytes(&expected));
    }
}

fn bytes(value: &impl AnchorSerialize) -> Vec<u8> {
    let mut bytes = Vec::new();
    value.serialize(&mut bytes).unwrap();
    bytes
}

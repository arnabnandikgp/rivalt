use super::*;

fn assert_account_size<T: AccountSerialize + AccountDeserialize + Space>(
    account: &T,
    expected: usize,
) {
    let mut bytes = Vec::new();
    account.try_serialize(&mut bytes).unwrap();
    assert_eq!(bytes.len(), expected);
    assert_eq!(8 + T::INIT_SPACE, expected);
    T::try_deserialize(&mut bytes.as_slice()).unwrap();
}

#[test]
fn v2_wire_sizes_pin_bounded_accounts() {
    assert_account_size(&ClearingGroupV2::default(), 273);
    assert_account_size(&PortfolioV2::default(), 79);
    assert_account_size(&MarginAccountV2::default(), 970);
    assert_account_size(&GroupMarketV2::default(), 446);
    assert_account_size(&MakerRegistrationV2::default(), 326);
    assert_account_size(&CapitalBindingV2::default(), 106);
    assert_account_size(&GroupExitGuardV2::default(), 223);
    assert_account_size(
        &GroupRegistryV2 {
            members: vec![Pubkey::default(); MAX_MEMBERS],
            ..Default::default()
        },
        2097,
    );
    assert_account_size(
        &GroupResolutionV2 {
            rows: vec![GroupResolutionRowV2::default(); MAX_MEMBERS],
            ..Default::default()
        },
        9127,
    );
}

#[test]
fn v2_mode_indices_and_maker_isolation_are_protocol_rules() {
    for portfolio_index in 0..MAX_PORTFOLIOS {
        assert!(valid_identity(
            portfolio_index,
            0,
            MODE_CROSS,
            255,
            ROLE_TRADER
        ));
        assert!(valid_identity(
            portfolio_index,
            0,
            MODE_CROSS,
            255,
            ROLE_RECEIVER
        ));
        assert!(!valid_identity(
            portfolio_index,
            0,
            MODE_CROSS,
            255,
            ROLE_MAKER
        ));
        for subaccount_index in 1..=MAX_SUBACCOUNT {
            for market_index in 0..2 {
                assert!(valid_identity(
                    portfolio_index,
                    subaccount_index,
                    MODE_ISOLATED,
                    market_index,
                    ROLE_MAKER
                ));
                assert!(!valid_identity(
                    portfolio_index,
                    subaccount_index,
                    MODE_CROSS,
                    market_index,
                    ROLE_TRADER
                ));
            }
        }
    }
    for invalid in [
        (4, 0, 0, 255, 0),
        (0, 9, 1, 0, 0),
        (0, 0, 1, 0, 0),
        (0, 1, 1, 2, 0),
        (0, 0, 0, 0, 0),
        (0, 0, 2, 255, 0),
        (0, 1, 1, 0, 3),
    ] {
        assert!(!valid_identity(
            invalid.0, invalid.1, invalid.2, invalid.3, invalid.4
        ));
    }
    assert_eq!(
        CROSS_TRADING_IMPLEMENTED,
        cfg!(feature = "cross-safety-qualification")
    );
}

#[test]
fn v2_identity_separates_group_portfolio_children_and_legacy() {
    let program = crate::ID;
    let owner = Pubkey::new_unique();
    let mut identities = std::collections::HashSet::new();
    for domain in [[1; 32], [2; 32]] {
        let (group, _) = Pubkey::find_program_address(&[b"group-v2", &domain], &program);
        for index in 0..MAX_PORTFOLIOS {
            let (portfolio, _) = Pubkey::find_program_address(
                &[
                    b"portfolio-v2",
                    group.as_ref(),
                    owner.as_ref(),
                    &index.to_le_bytes(),
                ],
                &program,
            );
            for child in 0..=MAX_SUBACCOUNT {
                let (margin, _) = Pubkey::find_program_address(
                    &[b"margin-v2", portfolio.as_ref(), &child.to_le_bytes()],
                    &program,
                );
                assert!(identities.insert(margin));
            }
        }
    }
    let (market, _) = Pubkey::find_program_address(&[b"market", b"BTC"], &program);
    let (legacy, _) =
        Pubkey::find_program_address(&[b"participant", market.as_ref(), owner.as_ref()], &program);
    assert!(!identities.contains(&legacy));
    assert_eq!(identities.len(), 72);
}

#[test]
fn v2_two_slot_wire_retains_fraction_and_generation_independently() {
    let mut margin = MarginAccountV2::default();
    margin.schema_version = 2;
    margin.cash = 99;
    margin.positions[0] = Position {
        lots: 0,
        virtual_scaled: -300_000_000,
        funding_checkpoint_scaled: 100_000_000,
        generation: 7,
    };
    margin.positions[1] = Position {
        lots: -3,
        virtual_scaled: 400_000_001,
        funding_checkpoint_scaled: -100_000_000,
        generation: 11,
    };
    let mut bytes = Vec::new();
    margin.try_serialize(&mut bytes).unwrap();
    // Literal Borsh offsets include the discriminator and fixed identity header.
    assert_eq!(u64::from_le_bytes(bytes[113..121].try_into().unwrap()), 99);
    assert_eq!(
        i128::from_le_bytes(bytes[129..145].try_into().unwrap()),
        -300_000_000
    );
    assert_eq!(
        i128::from_le_bytes(bytes[177..193].try_into().unwrap()),
        400_000_001
    );
    let decoded = MarginAccountV2::try_deserialize(&mut bytes.as_slice()).unwrap();
    assert_eq!(decoded.positions[0].generation, 7);
    assert_eq!(decoded.positions[1].generation, 11);
}

#[test]
fn v2_discriminators_do_not_reinterpret_legacy_accounts() {
    use anchor_lang::Discriminator;
    assert_ne!(
        MarginAccountV2::DISCRIMINATOR,
        crate::state::Participant::DISCRIMINATOR
    );
    assert_ne!(
        ClearingGroupV2::DISCRIMINATOR,
        crate::state::MarketState::DISCRIMINATOR
    );
    assert_ne!(
        GroupResolutionV2::DISCRIMINATOR,
        crate::state::ResolutionState::DISCRIMINATOR
    );
    let mut bytes = Vec::new();
    MarginAccountV2::default()
        .try_serialize(&mut bytes)
        .unwrap();
    bytes[..8].copy_from_slice(crate::state::Participant::DISCRIMINATOR);
    assert!(MarginAccountV2::try_deserialize(&mut bytes.as_slice()).is_err());
}

#[test]
fn cohort_decode_retains_wire_and_preallocates_bounded_capacity() {
    let resolution = GroupResolutionV2 {
        rows: vec![GroupResolutionRowV2::default(); 64],
        ..Default::default()
    };
    let mut bytes = Vec::new();
    resolution.try_serialize(&mut bytes).unwrap();
    let decoded = GroupResolutionV2::try_deserialize(&mut bytes.as_slice()).unwrap();
    assert_eq!((decoded.rows.len(), decoded.rows.capacity()), (64, 64));
    let mut roundtrip = Vec::new();
    decoded.try_serialize(&mut roundtrip).unwrap();
    assert_eq!(bytes, roundtrip);
    // The vector count follows discriminator, schema, group and the 376-byte header.
    assert_eq!(&bytes[418..422], &64u32.to_le_bytes());
    for count in [65u32, u32::MAX] {
        let mut invalid = bytes.clone();
        invalid[418..422].copy_from_slice(&count.to_le_bytes());
        assert!(GroupResolutionV2::try_deserialize(&mut invalid.as_slice()).is_err());
    }
    let registry = GroupRegistryV2 {
        count: 64,
        members: (0..64).map(|_| Pubkey::new_unique()).collect(),
        ..Default::default()
    };
    let mut bytes = Vec::new();
    registry.try_serialize(&mut bytes).unwrap();
    let decoded = GroupRegistryV2::try_deserialize(&mut bytes.as_slice()).unwrap();
    assert_eq!(
        (decoded.members.len(), decoded.members.capacity()),
        (64, 64)
    );
    assert_eq!(decoded.members, registry.members);
}

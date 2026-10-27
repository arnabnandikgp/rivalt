use super::*;
use anchor_lang::Discriminator;

fn wire<T: AccountSerialize + AccountDeserialize + Space>(account: T, size: usize) {
    let mut bytes = Vec::new();
    account.try_serialize(&mut bytes).unwrap();
    assert_eq!(bytes.len(), size);
    assert_eq!(8 + T::INIT_SPACE, size);
    let decoded = T::try_deserialize(&mut bytes.as_slice()).unwrap();
    let mut roundtrip = Vec::new();
    decoded.try_serialize(&mut roundtrip).unwrap();
    assert_eq!(bytes, roundtrip);
}

#[test]
fn exact_contract_sizes_and_roundtrips() {
    wire(VenueV3::default(), 321);
    wire(CustodyV3::default(), 83);
    wire(SafetyV3::default(), 77);
    wire(RetirementCertificateV3::default(), 80);
    assert_ne!(
        RetirementCertificateV3::DISCRIMINATOR,
        SettlementCertificateV3::DISCRIMINATOR
    );
    wire(
        VenueRegistryV3 {
            members: vec![Pubkey::default(); 64],
            ..Default::default()
        },
        2105,
    );
    wire(PortfolioV3::default(), 79);
    wire(MarginAccountV3::default(), 970);
    wire(MarketV3::default(), 447);
    wire(MarketLedgerV3::default(), 109);
    wire(MakerRegistrationV3::default(), 326);
    wire(CapitalBindingV3::default(), 106);
    wire(SettlementCertificateV3::default(), 234);
    wire(ResolutionPageV3::default(), 3400);
    wire(ResolutionV3::default(), 3644);
    wire(ResolutionWorkV3::default(), 7918);
}

#[test]
fn no_old_account_discriminator_or_seed_is_reinterpreted() {
    assert_ne!(
        MarginAccountV3::DISCRIMINATOR,
        crate::state::v2::MarginAccountV2::DISCRIMINATOR
    );
    assert_ne!(
        MarginAccountV3::DISCRIMINATOR,
        crate::state::Participant::DISCRIMINATOR
    );
    let owner = Pubkey::new_unique();
    let mut keys = std::collections::HashSet::new();
    for domain in [[1; 32], [2; 32]] {
        let venue = Pubkey::find_program_address(&[b"venue-v3", &domain], &crate::ID).0;
        let old = Pubkey::find_program_address(&[b"group-v2", &domain], &crate::ID).0;
        assert_ne!(venue, old);
        for portfolio_index in 0u16..4 {
            let portfolio = Pubkey::find_program_address(
                &[
                    b"portfolio-v3",
                    venue.as_ref(),
                    owner.as_ref(),
                    &portfolio_index.to_le_bytes(),
                ],
                &crate::ID,
            )
            .0;
            for child_index in 0u16..9 {
                let child = Pubkey::find_program_address(
                    &[b"margin-v3", portfolio.as_ref(), &child_index.to_le_bytes()],
                    &crate::ID,
                )
                .0;
                assert!(keys.insert(child));
            }
        }
    }
    assert_eq!(keys.len(), 72);
    assert_eq!(
        TRADING_IMPLEMENTED,
        cfg!(feature = "account-safety-qualification")
    );
    assert!(!valid_identity(
        0,
        0,
        MODE_CROSS,
        CROSS_MARKET_SENTINEL,
        ROLE_MAKER
    ));
}

#[test]
fn fractional_positions_and_wide_numerators_preserve_every_byte() {
    let mut margin = MarginAccountV3::default();
    margin.schema_version = SCHEMA_VERSION;
    margin.cash = 99;
    margin.positions[0].virtual_scaled = -300_000_001;
    margin.positions[1].virtual_scaled = 400_000_001;
    let mut bytes = Vec::new();
    margin.try_serialize(&mut bytes).unwrap();
    assert_eq!(
        i128::from_le_bytes(bytes[129..145].try_into().unwrap()),
        -300_000_001
    );
    assert_eq!(
        i128::from_le_bytes(bytes[177..193].try_into().unwrap()),
        400_000_001
    );
    bytes[..8].copy_from_slice(crate::state::v2::MarginAccountV2::DISCRIMINATOR);
    assert!(MarginAccountV3::try_deserialize(&mut bytes.as_slice()).is_err());
    let mut page = ResolutionPageV3::default();
    page.rows[1].exact_flow_numerators[1].limbs[95] = u64::MAX;
    page.rows[1].exact_flow_numerators[1].limbs[0] = 1;
    wire(page, 3400);
}

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
    wire(Venue::default(), 329);
    wire(Custody::default(), 59);
    wire(VenueSafety::default(), 85);
    wire(RetirementCertificate::default(), 80);
    assert_ne!(
        RetirementCertificate::DISCRIMINATOR,
        SettlementCertificate::DISCRIMINATOR
    );
    wire(
        VenueRegistry {
            members: vec![Pubkey::default(); 64],
            ..Default::default()
        },
        2113,
    );
    wire(Portfolio::default(), 87);
    wire(MarginAccount::default(), 978);
    wire(Market::default(), 455);
    wire(MarketLedger::default(), 125);
    wire(CapitalBinding::default(), 114);
    wire(SettlementCertificate::default(), 234);
    wire(ResolutionPage::default(), 3408);
    wire(Resolution::default(), 3652);
    wire(ResolutionWork::default(), 7926);
}

#[test]
fn no_old_account_discriminator_or_seed_is_reinterpreted() {
    assert_ne!(
        MarginAccount::DISCRIMINATOR,
        &[143, 117, 33, 76, 190, 108, 140, 149]
    );
    assert_ne!(
        MarginAccount::DISCRIMINATOR,
        &[32, 142, 108, 87, 247, 179, 54, 6]
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
        cfg!(feature = "liquidity-execution-qualification")
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
    let mut margin = MarginAccount::default();
    margin.schema_version = SCHEMA_VERSION;
    margin.cash = 99;
    margin.positions[0].virtual_scaled = -300_000_001;
    margin.positions[1].virtual_scaled = 400_000_001;
    let mut bytes = Vec::new();
    margin.try_serialize(&mut bytes).unwrap();
    assert_eq!(
        i128::from_le_bytes(bytes[137..153].try_into().unwrap()),
        -300_000_001
    );
    assert_eq!(
        i128::from_le_bytes(bytes[185..201].try_into().unwrap()),
        400_000_001
    );
    bytes[..8].copy_from_slice(&[143, 117, 33, 76, 190, 108, 140, 149]);
    assert!(MarginAccount::try_deserialize(&mut bytes.as_slice()).is_err());
    let mut page = ResolutionPage::default();
    page.rows[1].exact_flow_numerators[1].limbs[95] = u64::MAX;
    page.rows[1].exact_flow_numerators[1].limbs[0] = 1;
    wire(page, 3408);
}

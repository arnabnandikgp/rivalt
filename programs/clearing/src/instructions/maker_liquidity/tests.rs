use super::*;

fn state() -> (Venue, Custody, VenueSafety, Market) {
    (
        Venue {
            schema_version: crate::state::accounts::SCHEMA_VERSION,
            profile_version: crate::state::accounts::PROFILE_VERSION,
            market_count: 2,
            insurance_fee_share_bps: 2500,
            ..Default::default()
        },
        Custody {
            schema_version: crate::state::accounts::SCHEMA_VERSION,
            ..Default::default()
        },
        VenueSafety {
            schema_version: crate::state::accounts::SCHEMA_VERSION,
            mode: CUSTODY,
            ..Default::default()
        },
        Market {
            schema_version: crate::state::accounts::SCHEMA_VERSION,
            ..Default::default()
        },
    )
}

#[test]
fn current_profile_is_explicit_and_retired_profiles_reject() {
    let (mut venue, custody, safety, market) = state();
    assert_eq!(
        super::super::account_trading::base_profile(&venue, &custody, &safety).is_ok(),
        cfg!(feature = "liquidity-execution-qualification")
    );
    assert_eq!(
        custody_only(&venue, &safety, &market).is_ok(),
        cfg!(feature = "liquidity-execution-qualification")
    );
    assert_eq!(
        super::super::account_custody::custody_profile(&venue, &custody, &safety).is_ok(),
        cfg!(feature = "liquidity-execution-qualification")
    );
    venue.profile_version = 3;
    assert!(custody_only(&venue, &safety, &market).is_err());
    assert!(super::super::account_trading::base_profile(&venue, &custody, &safety).is_err());
}

#[test]
fn liquidity_controls_refuse_financial_state_and_allow_paused_quarantine_only() {
    let (venue, custody, mut safety, mut market) = state();
    for mode in [ACTIVE, FROZEN, RESOLVED, RETIRED] {
        safety.mode = mode;
        assert!(custody_base(&venue, &safety, &market).is_err());
    }
    safety.mode = CUSTODY;
    safety.paused = true;
    assert!(custody_only(&venue, &safety, &market).is_err());
    assert_eq!(
        custody_base(&venue, &safety, &market).is_ok(),
        cfg!(feature = "liquidity-execution-qualification")
    );
    safety.paused = false;
    market.funding_index_scaled = 1;
    assert!(custody_base(&venue, &safety, &market).is_err());
    market.funding_index_scaled = 0;
    market.gross_lots = 1;
    assert!(custody_base(&venue, &safety, &market).is_err());
    market.gross_lots = 0;
    market.oracle.held_until = 1;
    assert!(custody_base(&venue, &safety, &market).is_err());
}

#[test]
fn liquidity_sampling_controls_require_the_separate_candidate_and_refuse_frozen_state() {
    let (mut venue, custody, mut safety, mut market) = state();
    market.funding_index_scaled = 7;
    market.gross_lots = 12;
    market.oracle.held_until = 106;
    market.oracle.sampled_at = 100;
    for mode in [CUSTODY, ACTIVE] {
        safety.mode = mode;
        assert_eq!(
            execution_profile(&venue, &safety, &market).is_ok(),
            cfg!(feature = "liquidity-execution-qualification")
        );
        assert_eq!(
            control_base(&venue, &safety, &market).is_ok(),
            cfg!(feature = "liquidity-execution-qualification")
        );
        safety.paused = true;
        assert!(execution_profile(&venue, &safety, &market).is_err());
        assert_eq!(
            control_base(&venue, &safety, &market).is_ok(),
            cfg!(feature = "liquidity-execution-qualification")
        );
        safety.paused = false;
    }
    for mode in [FROZEN, RESOLVED, RETIRED] {
        safety.mode = mode;
        assert!(execution_base(&venue, &safety, &market).is_err());
        assert!(control_base(&venue, &safety, &market).is_err());
    }
    safety.mode = ACTIVE;
    venue.profile_version = 3;
    assert!(execution_base(&venue, &safety, &market).is_err());
}

#[test]
fn liquidity_registry_layouts_match_the_frozen_contract() {
    assert_eq!(LiquidityRegistry::INIT_SPACE + 8, 181);
    assert_eq!(MakerRegistration::INIT_SPACE + 8, 341);
    let registration = MakerRegistration {
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        revision: 0,
        venue: Address::default(),
        market: Address::default(),
        capital: Address::default(),
        owner: Address::default(),
        pricing_program: Address::default(),
        program_data: Address::default(),
        config: Address::default(),
        price: Address::default(),
        approved_hash: [0; 32],
        instance: 2,
        authority_epoch: 3,
        depth_epoch: 4,
        buy_consumed: 5,
        sell_consumed: 6,
        quarantined: true,
        bump: 7,
    };
    let mut raw = Vec::new();
    crate::wire::write_discriminated(&registration, &mut raw).unwrap();
    assert_eq!(raw.len(), 341);
    assert_eq!(raw[306], 2);
    assert_eq!(&raw[323..331], &5u64.to_le_bytes());
    assert_eq!(&raw[339..341], &[1, 7]);
}

#[test]
fn liquidity_event_payloads_preserve_account_field_bytes_without_discriminators() {
    let registry = LiquidityRegistry {
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        revision: 0,
        venue: Address::new_unique(),
        market: Address::new_unique(),
        count: 3,
        sealed: true,
        registrations: [Address::new_unique(); 3],
        bump: 254,
    };
    let registration = MakerRegistration {
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        revision: 0,
        venue: registry.venue,
        market: registry.market,
        capital: Address::new_unique(),
        owner: Address::new_unique(),
        pricing_program: Address::new_unique(),
        program_data: Address::new_unique(),
        config: Address::new_unique(),
        price: Address::new_unique(),
        approved_hash: [123; 32],
        instance: 2,
        authority_epoch: 7,
        depth_epoch: 8,
        buy_consumed: 9,
        sell_consumed: 10,
        quarantined: true,
        bump: 253,
    };
    let mut account_bytes = Vec::new();
    let mut payload_bytes = Vec::new();
    crate::wire::write_discriminated(&registry, &mut account_bytes).unwrap();
    crate::wire::write(
        &LiquidityRegistryPayload::from(&registry),
        &mut payload_bytes,
    )
    .unwrap();
    assert_eq!(account_bytes[8..], payload_bytes);
    account_bytes.clear();
    payload_bytes.clear();
    crate::wire::write_discriminated(&registration, &mut account_bytes).unwrap();
    crate::wire::write(
        &MakerRegistrationPayload::from(&registration),
        &mut payload_bytes,
    )
    .unwrap();
    assert_eq!(account_bytes[8..], payload_bytes);
}

use super::*;

fn state() -> (VenueV3, CustodyV3, SafetyV3, MarketV3) {
    (
        VenueV3 {
            schema_version: 3,
            profile_version: 4,
            market_count: 2,
            insurance_fee_share_bps: 2500,
            ..Default::default()
        },
        CustodyV3 {
            schema_version: 3,
            ..Default::default()
        },
        SafetyV3 {
            schema_version: 3,
            mode: CUSTODY,
            ..Default::default()
        },
        MarketV3 {
            schema_version: 3,
            ..Default::default()
        },
    )
}

#[test]
fn liquidity_profile_cannot_enter_existing_trading_even_in_a_combined_build() {
    let (mut venue, custody, safety, market) = state();
    assert!(super::super::account_trading::base_profile(&venue, &custody, &safety).is_err());
    assert_eq!(
        custody_only(&venue, &custody, &safety, &market).is_ok(),
        cfg!(feature = "maker-liquidity-qualification")
    );
    assert_eq!(
        super::super::account_custody::custody_profile(&venue, &custody, &safety).is_ok(),
        cfg!(feature = "maker-liquidity-qualification")
    );
    venue.profile_version = 3;
    assert!(custody_only(&venue, &custody, &safety, &market).is_err());
    assert_eq!(
        super::super::account_trading::base_profile(&venue, &custody, &safety).is_ok(),
        cfg!(feature = "account-trading-qualification")
    );
}

#[test]
fn liquidity_controls_refuse_financial_state_and_allow_paused_quarantine_only() {
    let (venue, custody, mut safety, mut market) = state();
    for mode in [ACTIVE, FROZEN, RESOLVED, RETIRED] {
        safety.mode = mode;
        assert!(custody_base(&venue, &custody, &safety, &market).is_err());
    }
    safety.mode = CUSTODY;
    safety.paused = true;
    assert!(custody_only(&venue, &custody, &safety, &market).is_err());
    assert_eq!(
        custody_base(&venue, &custody, &safety, &market).is_ok(),
        cfg!(feature = "maker-liquidity-qualification")
    );
    safety.paused = false;
    market.funding_index_scaled = 1;
    assert!(custody_base(&venue, &custody, &safety, &market).is_err());
    market.funding_index_scaled = 0;
    market.gross_lots = 1;
    assert!(custody_base(&venue, &custody, &safety, &market).is_err());
    market.gross_lots = 0;
    market.oracle.held_until = 1;
    assert!(custody_base(&venue, &custody, &safety, &market).is_err());
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
        assert_eq!(execution_profile(&venue, &custody, &safety, &market).is_ok(),
            cfg!(feature = "liquidity-execution-qualification"));
        assert_eq!(control_base(&venue, &custody, &safety, &market).is_ok(),
            cfg!(feature = "liquidity-execution-qualification"));
        safety.paused = true;
        assert!(execution_profile(&venue, &custody, &safety, &market).is_err());
        assert_eq!(control_base(&venue, &custody, &safety, &market).is_ok(),
            cfg!(feature = "liquidity-execution-qualification"));
        safety.paused = false;
    }
    for mode in [FROZEN, RESOLVED, RETIRED] {
        safety.mode = mode;
        assert!(execution_base(&venue, &custody, &safety, &market).is_err());
        assert!(control_base(&venue, &custody, &safety, &market).is_err());
    }
    safety.mode = ACTIVE;
    venue.profile_version = 3;
    assert!(execution_base(&venue, &custody, &safety, &market).is_err());
}

#[test]
fn liquidity_sampling_records_match_pinned_widths_offsets_and_v3_event_prefix() {
    use crate::state::v4::{SampleInputV4, SampleLegV4};
    fn bytes(value: &impl AnchorSerialize) -> Vec<u8> {
        let mut result = Vec::new();
        value.serialize(&mut result).unwrap();
        result
    }
    let input = SampleInputV4 {
        registration: Pubkey::new_unique(), capital: Pubkey::new_unique(),
        authority_epoch: 1, control_epoch: 2, shape_epoch: 3, depth_epoch: 4,
        price_sequence: 5, buy_consumed: 6, sell_consumed: 7, expiry_slot: 8, expiry_time: 9,
    };
    let input_bytes = bytes(&input);
    assert_eq!(input_bytes.len(), 136);
    for (index, value) in (1u64..=9).enumerate() {
        assert_eq!(&input_bytes[64 + index * 8..72 + index * 8], &value.to_le_bytes());
    }
    let leg = SampleLegV4 { instance: 2, lots: 30, gross: 1800030 };
    let leg_bytes = bytes(&leg);
    assert_eq!(leg_bytes.len(), 17);
    assert_eq!(leg_bytes[0], 2);
    assert_eq!(&leg_bytes[1..9], &30u64.to_le_bytes());
    let (_, _, _, market) = state();
    let base = AccountOracleChangedV3 { venue: Pubkey::new_unique(), sequence: 31, slot: 100,
        market: Pubkey::new_unique(), state: MarketSnapshotV3::from(&market) };
    let event = LiquidityOracleChangedV4 {
        venue: base.venue, sequence: base.sequence, slot: base.slot, market: base.market,
        state: MarketSnapshotV3::from(&market), inputs: [input; 3],
        bid_legs: vec![leg], ask_legs: vec![leg, leg],
    };
    let base_bytes = bytes(&base);
    let event_bytes = bytes(&event);
    assert_eq!(&event_bytes[..base_bytes.len()], base_bytes);
    let mut expected_tail = input_bytes.repeat(3);
    expected_tail.extend_from_slice(&1u32.to_le_bytes());
    expected_tail.extend_from_slice(&leg_bytes);
    expected_tail.extend_from_slice(&2u32.to_le_bytes());
    expected_tail.extend_from_slice(&leg_bytes.repeat(2));
    assert_eq!(&event_bytes[base_bytes.len()..], expected_tail);
}

#[test]
fn liquidity_registry_layouts_match_the_frozen_contract() {
    assert_eq!(LiquidityRegistryV4::INIT_SPACE + 8, 173);
    assert_eq!(MakerRegistrationV4::INIT_SPACE + 8, 333);
    let registration = MakerRegistrationV4 {
        schema_version: 4,
        venue: Pubkey::default(),
        market: Pubkey::default(),
        capital: Pubkey::default(),
        owner: Pubkey::default(),
        pricing_program: Pubkey::default(),
        program_data: Pubkey::default(),
        config: Pubkey::default(),
        price: Pubkey::default(),
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
    registration.try_serialize(&mut raw).unwrap();
    assert_eq!(raw.len(), 333);
    assert_eq!(raw[298], 2);
    assert_eq!(&raw[315..323], &5u64.to_le_bytes());
    assert_eq!(&raw[331..333], &[1, 7]);
}

#[test]
fn liquidity_event_payloads_preserve_account_field_bytes_without_discriminators() {
    let registry = LiquidityRegistryV4 {
        schema_version: 4,
        venue: Pubkey::new_unique(),
        market: Pubkey::new_unique(),
        count: 3,
        sealed: true,
        registrations: [Pubkey::new_unique(); 3],
        bump: 254,
    };
    let registration = MakerRegistrationV4 {
        schema_version: 4,
        venue: registry.venue,
        market: registry.market,
        capital: Pubkey::new_unique(),
        owner: Pubkey::new_unique(),
        pricing_program: Pubkey::new_unique(),
        program_data: Pubkey::new_unique(),
        config: Pubkey::new_unique(),
        price: Pubkey::new_unique(),
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
    registry.try_serialize(&mut account_bytes).unwrap();
    LiquidityRegistryPayloadV4::from(&registry)
        .serialize(&mut payload_bytes)
        .unwrap();
    assert_eq!(&account_bytes[8..], payload_bytes);
    account_bytes.clear();
    payload_bytes.clear();
    registration.try_serialize(&mut account_bytes).unwrap();
    MakerRegistrationPayloadV4::from(&registration)
        .serialize(&mut payload_bytes)
        .unwrap();
    assert_eq!(&account_bytes[8..], payload_bytes);
}

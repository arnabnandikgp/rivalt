use super::*;

fn fixture() -> (Venue, Market, FundingPublisher, FundingReport, Clock) {
    let venue = Venue {
        domain: [7; 32],
        ..Venue::default()
    };
    let market = Market {
        schema_version: 5,
        config_epoch: 4,
        terms_epoch: 2,
        observation_sequence: 9,
        ..Market::default()
    };
    let configuration = FundingPublisher {
        schema_version: 5,
        revision: 0,
        venue: Pubkey::new_unique(),
        market: Pubkey::new_unique(),
        publisher: Pubkey::new_unique(),
        authority_epoch: 3,
        last_sequence: 12,
        last_observed_slot: 1000,
        last_observed_time: 100,
        enabled: true,
        bump: 254,
    };
    let report = FundingReport {
        version: 1,
        domain: venue.domain,
        market: configuration.market,
        authority_epoch: 3,
        sequence: 13,
        expected_observation_sequence: 9,
        expected_config_epoch: 4,
        expected_terms_epoch: 2,
        observed_slot: 1010,
        observed_time: 101,
        valid_until_slot: 1160,
        valid_until_time: 107,
        reference_price: 60_000,
        quantity: 100,
        bid: 5_999_900,
        ask: 6_000_300,
        outcome: 0,
        input_digest: [8; 32],
    };
    let clock = Clock {
        slot: 1015,
        unix_timestamp: 102,
        ..Clock::default()
    };
    (venue, market, configuration, report, clock)
}

fn bounds(reference: u64) -> policy::Bounds {
    policy::Bounds {
        reference,
        lower: reference,
        upper: reference,
        normal: true,
        deadline: 120,
    }
}

#[test]
fn frozen_wire_widths_and_account_event_parity() {
    let (_, _, configuration, report, _) = fixture();
    let mut account_bytes = Vec::new();
    configuration.try_serialize(&mut account_bytes).unwrap();
    assert_eq!(account_bytes.len(), 148);
    assert_eq!(FundingPublisher::INIT_SPACE, 140);
    let mut payload_bytes = Vec::new();
    FundingPublisherPayload::from(&configuration)
        .serialize(&mut payload_bytes)
        .unwrap();
    assert_eq!(payload_bytes, account_bytes[8..]);
    let mut report_bytes = Vec::new();
    report.serialize(&mut report_bytes).unwrap();
    assert_eq!(report_bytes.len(), 203);
    // Independent offsets fix the signed report wire contract, not just round-trip parity.
    assert_eq!(&report_bytes[0..2], &[1, 0]);
    assert_eq!(&report_bytes[74..82], &13u64.to_le_bytes());
    assert_eq!(&report_bytes[146..154], &100u64.to_le_bytes());
    assert_eq!(report_bytes[170], 0);
    assert_eq!(&report_bytes[171..203], &[8; 32]);
}

#[test]
fn signed_report_rejects_replay_wrong_binding_and_stale_control_snapshot() {
    let (venue, market, configuration, report, clock) = fixture();
    assert!(validate_report(&venue, &market, &configuration, &report, &clock).is_ok());
    let mutations: &[fn(&mut FundingReport)] = &[
        |report| report.version = 2,
        |report| report.domain = [9; 32],
        |report| report.market = Pubkey::new_unique(),
        |report| report.authority_epoch -= 1,
        |report| report.sequence -= 1,
        |report| report.sequence += 1,
        |report| report.expected_observation_sequence -= 1,
        |report| report.expected_config_epoch -= 1,
        |report| report.expected_terms_epoch -= 1,
        |report| report.input_digest = [0; 32],
    ];
    for mutate in mutations {
        let mut invalid = report;
        mutate(&mut invalid);
        assert!(validate_report(&venue, &market, &configuration, &invalid, &clock).is_err());
    }
    let disabled = FundingPublisher {
        enabled: false,
        ..configuration
    };
    assert!(validate_report(&venue, &market, &disabled, &report, &clock).is_err());
}

#[test]
fn observation_fences_and_expiry_bound_latency_without_backdating() {
    let (venue, market, configuration, report, clock) = fixture();
    let mutations: &[fn(&mut FundingReport)] = &[
        |report| report.observed_slot = 1000, // snapshot before publisher authorization
        |report| report.observed_slot = 1016, // future slot
        |report| report.observed_time = 99,   // too old / before authority fence
        |report| report.observed_time = 103,  // future wall clock
        |report| report.valid_until_time = 102, // already expired
        |report| report.valid_until_time = 108, // hold exceeds six seconds
        |report| report.valid_until_slot = 1015,
        |report| report.valid_until_slot = 1161,
        |report| report.outcome = 4,
    ];
    for mutate in mutations {
        let mut invalid = report;
        mutate(&mut invalid);
        assert!(validate_report(&venue, &market, &configuration, &invalid, &clock).is_err());
    }
    let edge = Clock {
        unix_timestamp: 103,
        ..clock
    };
    assert!(validate_report(&venue, &market, &configuration, &report, &edge).is_ok());
    let late = Clock {
        unix_timestamp: 104,
        ..clock
    };
    assert!(validate_report(&venue, &market, &configuration, &report, &late).is_err());
}

#[test]
fn independent_index_fixes_quantity_and_permits_only_bounded_gross_prices() {
    let (_, _, _, report, _) = fixture();
    assert!(report_impact(&report, None).is_err());
    assert!(report_impact(&report, Some(bounds(59_999))).is_err());
    assert_eq!(
        report_impact(&report, Some(bounds(60_000)))
            .unwrap()
            .unwrap()
            .quantity,
        100
    );
    let mut boundary = FundingReport {
        bid: 5_400_000,
        ask: 6_600_000,
        ..report
    };
    assert!(report_impact(&boundary, Some(bounds(60_000))).is_ok());
    boundary.bid -= 1;
    assert!(report_impact(&boundary, Some(bounds(60_000))).is_err());
    boundary.bid = 5_400_000;
    boundary.ask += 1;
    assert!(report_impact(&boundary, Some(bounds(60_000))).is_err());
    assert!(report_impact(
        &FundingReport {
            quantity: 99,
            ..report
        },
        Some(bounds(60_000))
    )
    .is_err());
    assert!(report_impact(
        &FundingReport {
            ask: report.bid - 1,
            ..report
        },
        Some(bounds(60_000))
    )
    .is_err());
    let rounded = FundingReport {
        reference_price: 59_999,
        quantity: 101,
        bid: 6_059_899,
        ask: 6_059_899,
        ..report
    };
    assert!(report_impact(&rounded, Some(bounds(59_999))).is_ok());
}

#[test]
fn unavailable_attestation_carries_no_usable_price_or_expiry() {
    let (venue, market, configuration, report, clock) = fixture();
    for outcome in 1..=3 {
        let unavailable = FundingReport {
            outcome,
            reference_price: 0,
            quantity: 0,
            bid: 0,
            ask: 0,
            valid_until_slot: 0,
            valid_until_time: 0,
            ..report
        };
        assert!(validate_report(&venue, &market, &configuration, &unavailable, &clock).is_ok());
        assert!(report_impact(&unavailable, None).unwrap().is_none());
        for mutate in [
            (|report: &mut FundingReport| report.bid = 1) as fn(&mut FundingReport),
            |report| report.ask = 1,
            |report| report.reference_price = 1,
            |report| report.quantity = 1,
            |report| report.valid_until_slot = 1,
            |report| report.valid_until_time = 1,
        ] {
            let mut invalid = unavailable;
            mutate(&mut invalid);
            assert!(validate_report(&venue, &market, &configuration, &invalid, &clock).is_err());
        }
    }
}

#[test]
fn signed_available_reports_preserve_both_funding_cap_directions() {
    let (_, mut market, _, report, clock) = fixture();
    market.lots_per_unit = 1_000_000;
    market.cross_eligible = true;
    for (gross, expected_premium) in [(5_400_000, -300_000_000_000), (6_600_000, 300_000_000_000)] {
        let bounded = FundingReport {
            bid: gross,
            ask: gross,
            ..report
        };
        let impact = report_impact(&bounded, Some(bounds(60_000)))
            .unwrap()
            .unwrap();
        let next = funding::sample_candidate(
            CUSTODY,
            &market,
            &clock,
            Some(bounds(60_000)),
            [10; 4],
            Some(&impact),
        )
        .unwrap();
        // 10% allowed published premium is independently clamped to index*50bps:
        // 60,000 * 50 / 10,000 = 300 atoms per lot per hour, in either direction.
        assert_eq!(next.oracle.premium_scaled, expected_premium);
        assert_eq!(next.funding_index_scaled, 0); // custody never accrues active funding
    }
}

#[test]
fn report_receipt_starts_new_funding_at_landing_and_preserves_previous_earned_interval() {
    let (_, mut market, _, report, clock) = fixture();
    market.lots_per_unit = 1_000_000;
    market.cross_eligible = true;
    market.oracle.sampled_at = 100;
    market.oracle.held_until = 106;
    market.oracle.held_slot = 1200;
    market.oracle.held_epoch = market.config_epoch;
    market.oracle.premium_scaled = 36_000_000_000;
    market.oracle.valid_since = 90;
    market.oracle.last_qualified = 100;
    market.oracle.source_deadline = 120;
    market.oracle.status = 2;
    let impact = report_impact(&report, Some(bounds(60_000)))
        .unwrap()
        .unwrap();
    let next = funding::sample_candidate(
        ACTIVE,
        &market,
        &clock,
        Some(bounds(60_000)),
        [10; 4],
        Some(&impact),
    )
    .unwrap();
    // Previous 36 atoms/hour earns two seconds: 36e9 * 2 / 3600 = 20,000,000.
    assert_eq!(next.funding_index_scaled, 20_000_000);
    assert_eq!(next.oracle.sampled_at, 102); // observed at 101 is not an accrual start
    assert_eq!(next.oracle.held_until, 107);
    // ((5,999,900 + 6,000,300) / (2 * 100)) - 60,000 = +1 atom/lot/hour.
    assert_eq!(next.oracle.premium_scaled, 1_000_000_000);
    let stopped = funding::control_candidate(
        ACTIVE,
        &next,
        &Clock {
            slot: 1150,
            unix_timestamp: 109,
            ..clock
        },
    )
    .unwrap();
    assert_eq!(stopped.funding_index_scaled, 21_388_888); // only five new covered seconds
    assert_eq!(
        (
            stopped.oracle.covered_seconds,
            stopped.oracle.skipped_seconds
        ),
        (7, 2)
    );
    assert_eq!(stopped.oracle.quantity, 0);
}

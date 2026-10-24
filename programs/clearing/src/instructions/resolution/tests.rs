//! Serialized page-state regressions; signed runtime scenarios live in tests/rpc-contract.
use super::*;
use anchor_lang::{Discriminator, Space};
fn zero<T: AccountDeserialize + Discriminator + Space>() -> T {
    let mut bytes = vec![0; 8 + T::INIT_SPACE];
    bytes[..8].copy_from_slice(T::DISCRIMINATOR);
    T::try_deserialize(&mut bytes.as_slice()).unwrap()
}
fn persisted<T: AccountSerialize + AccountDeserialize>(value: &T) -> T {
    let mut bytes = Vec::new();
    value.try_serialize(&mut bytes).unwrap();
    T::try_deserialize(&mut bytes.as_slice()).unwrap()
}
#[test]
fn paginated_derived_headroom_and_terminal_generation_survive_every_page_size() {
    // This is a pure state-machine boundary test, not a chain fixture or a
    // claim that those extreme positions were opened by the RPC harness.
    for count in [2usize, 5, 64] {
        for page_size in 1..=4 {
            let price = math::MAX_PRICE;
            let funding = -math::MAX_FUNDING;
            let mut participants: Vec<Participant> = (0..count)
                .map(|id| {
                    let mut participant: Participant = zero();
                    participant.schema_version = 1;
                    participant.id = id as u16;
                    participant.cash = (id as u64) * 17;
                    participant.generation = if id < 2 { u64::MAX - 1 } else { u64::MAX };
                    participant.funding_checkpoint_scaled = math::MAX_FUNDING;
                    participant
                })
                .collect();
            participants[0].lots = math::MAX_LOTS;
            participants[1].lots = -math::MAX_LOTS;
            participants[0].virtual_scaled = math::MAX_SCALED;
            participants[1].virtual_scaled = -math::MAX_SCALED;
            for id in 2..count {
                let value = (id as i128) * 17 * math::SCALE + id as i128;
                participants[id].virtual_scaled = value;
                participants[1].virtual_scaled -= value;
            }
            // Keep each ordinary stored-v within its limit while adding a full
            // funding/price-derived interval beyond that limit on both sides.
            let excess = participants[1].virtual_scaled + math::MAX_SCALED;
            participants[1].virtual_scaled -= excess;
            participants[0].virtual_scaled += excess;
            let models: Vec<_> = participants
                .iter()
                .map(|participant| routes::participant_model(participant).unwrap())
                .collect();
            assert!(models[0].unpaid(price, funding).unwrap() > math::MAX_SCALED);
            assert!(models[1].unpaid(price, funding).unwrap() < -math::MAX_SCALED);
            let cash = participants
                .iter()
                .map(|participant| participant.cash)
                .sum::<u64>();
            let insurance = 10_007;
            let expected = math::closeout(
                &models,
                math::Pools {
                    vault: cash + insurance,
                    insurance,
                    ..math::Pools::default()
                },
                price,
                funding,
            )
            .unwrap();
            let mut market: MarketState = zero();
            market.total_cash = cash;
            market.insurance = insurance;
            market.allocated_vault = cash + insurance;
            let mut route_state: TestRouteState = zero();
            route_state.gross_lots = math::MAX_GROSS_LOTS;
            let mut resolution: ResolutionState = zero();
            resolution.rows = vec![ResolutionRow::default(); count];
            resolution.header = ResolutionHeader {
                epoch: 1,
                stage: VALUE,
                count: count as u16,
                price,
                funding,
                initial_cash: cash,
                initial_insurance: insurance,
                initial_vault: cash + insurance,
                remaining_gross: route_state.gross_lots,
                ..ResolutionHeader::default()
            };
            while resolution.header.stage < COMPLETE {
                let end = (usize::from(resolution.header.cursor) + page_size).min(count);
                for id in usize::from(resolution.header.cursor)..end {
                    process_row(
                        &mut market,
                        &mut route_state,
                        &mut resolution,
                        id,
                        &mut participants[id],
                    )
                    .unwrap();
                }
                resolution.header.cursor = end as u16;
                if end == count {
                    finish_pass(&mut market, &mut route_state, &mut resolution.header).unwrap();
                }
                cash_invariant(&market, &resolution.header, market.allocated_vault).unwrap();
                resolution = persisted(&resolution);
                participants = participants.iter().map(persisted).collect();
            }
            assert_eq!(market.insurance, expected.pools.insurance);
            assert_eq!(market.settlement, 0);
            for (id, participant) in participants.iter().enumerate() {
                let row = resolution.rows[id];
                assert_eq!(participant.cash, expected.participants[id].cash);
                assert_eq!(participant.lots, 0);
                assert_eq!(participant.virtual_scaled, 0);
                assert_eq!(participant.generation, u64::MAX);
                assert_eq!(row.collected, expected.collected[id]);
                assert_eq!(row.insured_scaled as i128, expected.insured_scaled[id]);
                assert_eq!(row.impaired_scaled as i128, expected.impaired_scaled[id]);
                assert_eq!(row.rounding_scaled, expected.rounding_scaled[id]);
                assert_eq!(row.paid, expected.paid[id]);
            }
        }
    }
}
#[test]
fn one_atom_terminal_tie_goes_to_lower_stable_id_with_zero_sum_adjustments() {
    for size in 1..=4 {
        let mut participants: Vec<Participant> = (0..3)
            .map(|id| {
                let mut participant: Participant = zero();
                participant.schema_version = 1;
                participant.id = id;
                participant
            })
            .collect();
        participants[0].virtual_scaled = -5 * math::SCALE;
        participants[1].virtual_scaled = 5 * math::SCALE / 2;
        participants[2].virtual_scaled = 5 * math::SCALE / 2;
        let mut market: MarketState = zero();
        market.insurance = 1;
        market.allocated_vault = 1;
        let mut route_state: TestRouteState = zero();
        let mut resolution: ResolutionState = zero();
        resolution.rows = vec![ResolutionRow::default(); 3];
        resolution.header = ResolutionHeader {
            epoch: 1,
            stage: VALUE,
            count: 3,
            price: 60_000,
            initial_insurance: 1,
            initial_vault: 1,
            ..ResolutionHeader::default()
        };
        while resolution.header.stage < COMPLETE {
            let end = (usize::from(resolution.header.cursor) + size).min(3);
            for id in usize::from(resolution.header.cursor)..end {
                process_row(
                    &mut market,
                    &mut route_state,
                    &mut resolution,
                    id,
                    &mut participants[id],
                )
                .unwrap();
            }
            resolution.header.cursor = end as u16;
            if end == 3 {
                finish_pass(&mut market, &mut route_state, &mut resolution.header).unwrap();
            }
            cash_invariant(&market, &resolution.header, 1).unwrap();
            resolution = persisted(&resolution);
        }
        // Two exact 0.5-atom entitlements share one actually funded atom.
        assert_eq!(
            participants
                .iter()
                .map(|participant| participant.cash)
                .collect::<Vec<_>>(),
            vec![0, 1, 0]
        );
        assert_eq!(
            resolution
                .rows
                .iter()
                .map(|route_state| route_state.insured_scaled)
                .collect::<Vec<_>>(),
            vec![math::SCALE as u128, 0, 0]
        );
        assert_eq!(
            resolution
                .rows
                .iter()
                .map(|route_state| route_state.impaired_scaled)
                .collect::<Vec<_>>(),
            vec![0, 2 * math::SCALE as u128, 2 * math::SCALE as u128]
        );
        assert_eq!(
            resolution
                .rows
                .iter()
                .map(|route_state| route_state.rounding_scaled)
                .collect::<Vec<_>>(),
            vec![0, math::SCALE / 2, -math::SCALE / 2]
        );
        assert_eq!(
            (market.insurance, market.settlement, market.total_cash),
            (0, 0, 1)
        );
    }
}
#[test]
fn freeze_accounts_only_materialized_prefix_and_records_uncovered_tail() {
    let mut market: MarketState = zero();
    market.funding_time = 104;
    let mut observation = crate::state::OracleState {
        sampled_at: 100,
        held_until: 106,
        covered_seconds: 20,
        skipped_seconds: 2,
        ..crate::state::OracleState::default()
    };
    freeze_coverage(&market, &mut observation, 107).unwrap();
    assert_eq!(
        (observation.covered_seconds, observation.skipped_seconds),
        (24, 5)
    );
    market.funding_time = 100;
    let mut observation = crate::state::OracleState {
        sampled_at: 100,
        held_until: 106,
        ..crate::state::OracleState::default()
    };
    freeze_coverage(&market, &mut observation, 200).unwrap();
    assert_eq!(
        (observation.covered_seconds, observation.skipped_seconds),
        (0, 100)
    );
}

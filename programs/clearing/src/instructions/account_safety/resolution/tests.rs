//! Literal expectations against the functions called by the frozen handlers.
//! Signed accounts, source authentication and resource limits require runtime tests.
use super::*;
use crate::state::Position;
use math::{oracle::Bounds, SCALE};

fn root(id: u64, cash: u64, claims: [i128; 2]) -> MarginAccount {
    MarginAccount {
            lifecycle: crate::state::accounts::MEMBER_FINANCIAL,
            activation_generation: 1,
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        id,
        cash,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        delegate_epoch: 1,
        positions: claims.map(|claim| Position {
            virtual_scaled: claim,
            generation: 4,
            ..Default::default()
        }),
        ..Default::default()
    }
}
fn markets() -> [Market; 2] {
    [Market::default(), Market::default()]
}
fn bounds() -> [Option<Bounds>; 2] {
    [Some(Bounds {
        reference: 100,
        lower: 90,
        upper: 110,
        normal: true,
        deadline: 1020,
    }); 2]
}

#[test]
fn only_bankruptcy_or_unpaid_flat_gross_debt_is_permissionless() {
    let markets = markets();
    let mut target = root(0, 1, [-102 * SCALE, 0]);
    target.positions[0].lots = 1; // common net = -1: actual bankruptcy.
    assert!(freeze::authorized_prices(
        &target,
        markets.each_ref(),
        bounds(),
        [0; 2],
        false,
        false,
        1000
    )
    .is_ok());
    target.positions[0].virtual_scaled = -100 * SCALE;
    // Common net +1, conservative risk -9 and MM deficit: liquidation, not default.
    assert!(freeze::authorized_prices(
        &target,
        markets.each_ref(),
        bounds(),
        [0; 2],
        false,
        true,
        1000
    )
    .is_err());
    let flat = root(0, 0, [-10 * SCALE, 10 * SCALE]);
    assert_eq!(
        freeze::authorized_prices(
            &flat,
            markets.each_ref(),
            [None; 2],
            [0; 2],
            false,
            false,
            1000
        )
        .unwrap(),
        [1; 2]
    );
    let backed = root(0, 10, [-10 * SCALE, 10 * SCALE]);
    assert!(freeze::authorized_prices(
        &backed,
        markets.each_ref(),
        [None; 2],
        [0; 2],
        false,
        false,
        1000
    )
    .is_err());
    let fractional = root(0, 10, [-10 * SCALE - 1, 11 * SCALE]);
    assert!(freeze::authorized_prices(
        &fractional,
        markets.each_ref(),
        [None; 2],
        [0; 2],
        false,
        false,
        1000
    )
    .is_ok());
}

#[test]
fn emergency_requires_exposed_missing_source_authority_and_full_grace() {
    let mut markets = markets();
    markets[1].gross_lots = 2;
    markets[1].oracle.source_deadline = 1000;
    let target = root(0, 50, [0; 2]);
    for (authority, now) in [(false, 1030), (true, 1029)] {
        assert!(freeze::authorized_prices(
            &target,
            markets.each_ref(),
            [bounds()[0], None],
            [0; 2],
            true,
            authority,
            now
        )
        .is_err());
    }
    assert_eq!(
        freeze::authorized_prices(
            &target,
            markets.each_ref(),
            [bounds()[0], None],
            [0; 2],
            true,
            true,
            1030
        )
        .unwrap(),
        [0; 2]
    );
    assert!(freeze::authorized_prices(
        &target,
        markets.each_ref(),
        bounds(),
        [0; 2],
        true,
        true,
        1030
    )
    .is_err());
    markets[1].gross_lots = 0;
    assert!(freeze::authorized_prices(
        &target,
        markets.each_ref(),
        [None; 2],
        [0; 2],
        true,
        true,
        1030
    )
    .is_err());
}

#[test]
fn valid_target_does_not_authorize_valuing_another_exposed_market_without_a_price() {
    let mut markets = markets();
    markets[1].gross_lots = 2;
    let target = root(0, 0, [-SCALE, 0]);
    assert_eq!(
        freeze::authorized_prices(
            &target,
            markets.each_ref(),
            [bounds()[0], None],
            [0; 2],
            false,
            false,
            1000
        )
        .unwrap(),
        [0; 2]
    );
    let mut exposed = target;
    exposed.positions[1].lots = 1;
    assert!(freeze::authorized_prices(
        &exposed,
        markets.each_ref(),
        [bounds()[0], None],
        [0; 2],
        false,
        false,
        1000
    )
    .is_err());
}

#[test]
fn financial_commitment_ignores_empty_churn_and_binds_live_membership() {
    let venue = Address::new_unique();
    let mut registry = VenueRegistry { schema_version: SCHEMA_VERSION, revision: 4, venue,
        membership_epoch: 7, next_id: 1u64 << 54, registered_count: 4, financial_count: 3,
        live_index: crate::instructions::account_membership::members::index_root(&venue), ..Default::default() };
    let committed = registry_hash(&registry).unwrap();
    registry.next_id += 1; registry.registered_count += 1; registry.revision += 1;
    assert_eq!(registry_hash(&registry).unwrap(), committed);
    registry.registered_count -= 1; registry.revision += 1;
    assert_eq!(registry_hash(&registry).unwrap(), committed);
    registry.membership_epoch += 1;
    assert_ne!(registry_hash(&registry).unwrap(), committed);
    registry.membership_epoch -= 1; registry.financial_count -= 1;
    assert_ne!(registry_hash(&registry).unwrap(), committed);
    registry.financial_count = 5;
    assert!(registry_hash(&registry).is_err());
    registry.financial_count = 3; registry.live_index = Address::new_unique();
    assert!(registry_hash(&registry).is_err());
}

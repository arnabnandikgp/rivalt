use super::*;
use financial_core::{backing::{Contribution, Summary}, SCALE};

fn fixture() -> (SettlementCertificate, MarketLedger, Venue, VenueSafety, VenueRegistry, Snapshot) {
    let address = Address::new_unique();
    let venue = Venue {terms_epoch: 4, ..Default::default()};
    let safety = VenueSafety {epoch: 3, ..Default::default()};
    let registry = VenueRegistry {schema_version: SCHEMA_VERSION, venue: address, membership_epoch: 2,
        financial_count: 2, registered_count: 2, next_id: 2,
        live_index: crate::instructions::account_membership::members::index_root(&address), ..Default::default()};
    let snapshot = super::super::tests::fixture_snapshot();
    let region = BackingRegion::around(snapshot.risks.map(|risk| [risk.lower,risk.upper]), snapshot.bounds).unwrap();
    let totals = Summary::default()
        .insert(Contribution {quantity: 1, fixed: -100*SCALE, bad: false, required: 1}).unwrap()
        .insert(Contribution {quantity: -1, fixed: 100*SCALE, bad: false, required: 1}).unwrap();
    let ledger = MarketLedger {schema_version: SCHEMA_VERSION, venue: address, backing: BackingState {
        epoch: 7, safety_epoch: 3, membership_epoch: 2, terms_epoch: 4, config_epochs: [1;2], region,
        summary: totals.checkpoint()}, ..Default::default()};
    let certificate = SettlementCertificate {schema_version: SCHEMA_VERSION, venue: address,
        backing_epoch: 7, count: 2, next: 2, complete: true, ..Default::default()};
    (certificate, ledger, venue, safety, registry, snapshot)
}

#[test]
fn in_region_observations_and_discovery_versions_preserve_completed_coverage() {
    let (certificate, mut ledger, venue, safety, registry, mut snapshot) = fixture();
    assert!(stamps(&certificate,&ledger,&venue,&safety,&registry,&snapshot,true).is_ok());
    ledger.liability_version += 99;
    for market in snapshot.markets.iter_mut().flatten() {market.observation_sequence += 123;}
    snapshot.risks[0].lower = 99; snapshot.risks[0].upper = 101;
    assert!(stamps(&certificate,&ledger,&venue,&safety,&registry,&snapshot,true).is_ok());
    assert!(!restart_allowed(&certificate,&ledger,&venue,&safety,&registry,&snapshot));
}

#[test]
fn stale_sources_block_use_without_authorizing_proof_erasure() {
    let (certificate, ledger, venue, safety, registry, mut snapshot) = fixture();
    snapshot.clock.unix_timestamp = 1_021;
    assert!(stamps(&certificate,&ledger,&venue,&safety,&registry,&snapshot,true).is_err());
    assert!(stamps(&certificate,&ledger,&venue,&safety,&registry,&snapshot,false).is_ok());
    assert!(!restart_allowed(&certificate,&ledger,&venue,&safety,&registry,&snapshot));
}

#[test]
fn only_partial_scans_can_restart_for_an_unseen_sibling_dependency() {
    let (mut certificate, ledger, venue, safety, registry, mut snapshot) = fixture();
    snapshot.risks[1].upper = 500;
    snapshot.markets[1].as_mut().unwrap().config_epoch += 1;
    assert!(stamps(&certificate,&ledger,&venue,&safety,&registry,&snapshot,true).is_ok());
    assert!(!restart_allowed(&certificate,&ledger,&venue,&safety,&registry,&snapshot));
    certificate.complete = false;
    assert!(restart_allowed(&certificate,&ledger,&venue,&safety,&registry,&snapshot));
    snapshot.risks[0].upper = 102;
    certificate.complete = true;
    assert!(stamps(&certificate,&ledger,&venue,&safety,&registry,&snapshot,false).is_err());
    assert!(restart_allowed(&certificate,&ledger,&venue,&safety,&registry,&snapshot));
}

#[test]
fn every_lifecycle_and_numeric_binding_fences_coverage() {
    for changed in 0..9 {
        let (mut certificate, mut ledger, mut venue, mut safety, mut registry, mut snapshot) = fixture();
        match changed {
            0 => certificate.backing_epoch += 1,
            1 => safety.epoch += 1,
            2 => registry.membership_epoch += 1,
            3 => venue.terms_epoch += 1,
            4 => snapshot.markets[0].as_mut().unwrap().config_epoch += 1,
            5 => certificate.next -= 1,
            6 => ledger.schema_version -= 1,
            7 => {registry.financial_count += 1; registry.registered_count += 1; registry.next_id += 1;},
            8 => ledger.venue = Address::new_unique(),
            _ => unreachable!(),
        }
        assert!(stamps(&certificate,&ledger,&venue,&safety,&registry,&snapshot,false).is_err(), "binding {changed}");
        assert!(restart_allowed(&certificate,&ledger,&venue,&safety,&registry,&snapshot));
    }
}

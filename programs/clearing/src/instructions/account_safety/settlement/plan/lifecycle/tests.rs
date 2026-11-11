use super::super::tests::{accept, advance, begin_order, fixture, flows, round_trip};
use super::*;

#[test]
fn exclusive_adoption_exactly_once_application_and_reconciliation_preserve_atom_owner() {
    for count in [3, 64] {
        let (mut header, rates, mut plan, mut rows, mut pages) = fixture(count);
        header.source_revision = 41;
        header.prices = [10, 20];
        for row in &mut rows {
            row.original_revision = 7;
            row.activation_generation = 1;
        }
        let mut source = Resolution {
            revision: 41,
            stage: crate::instructions::account_safety::resolution::VALUE,
            count: count as u64,
            ..Default::default()
        };
        assert!(adopt(&header, &rates, &mut plan, &mut source, 0).is_err());
        flows(&header, &rates, &mut plan, &rows, &mut pages, 128);
        begin_order(&header, &rates, &mut plan);
        for market in 0..2 {
            for ordinal in 0..count {
                accept(&header, &rates, &mut plan, &rows, &mut pages, ordinal).unwrap();
                while plan.stage == PLAN_ORDER_WORK
                    && plan.order_market == market
                    && order(&plan, binding(&header, &rates, &plan).unwrap())
                        .unwrap()
                        .position()
                        .is_err()
                {
                    advance(&header, &rates, &mut plan, &mut pages, 128);
                }
            }
        }
        while plan.stage != PLAN_READY {
            advance(&header, &rates, &mut plan, &mut pages, 128);
        }
        source.revision += 1;
        assert!(adopt(&header, &rates, &mut plan, &mut source, 0).is_err());
        source.revision -= 1;
        adopt(&header, &rates, &mut plan, &mut source, 0).unwrap();
        assert_eq!(
            (source.stage, plan.adoption_revision, plan.cursor),
            (14, 42, 0)
        );
        source.revision += 1; // The scoped wrapper owns this increment.
        assert!(adopt(&header, &rates, &mut plan, &mut source, 0).is_err());
        assert!(reset_order(&mut plan, 0, 1, Address::new_unique(), 1_000).is_err());
        let mut roots = Vec::new();
        let mut final_flows = Vec::new();
        for ordinal in 0..count {
            let frozen = &rows[ordinal as usize];
            let mut original = MarginAccount {
            lifecycle: crate::state::accounts::MEMBER_FINANCIAL,
            activation_generation: 1,
                schema_version: SCHEMA_VERSION,
                revision: 7,
                venue: header.venue,
                id: ordinal as u64,
                mode: MODE_CROSS,
                isolated_market_index: CROSS_MARKET_SENTINEL,
                delegate_epoch: 1,
                cash: frozen.cash,
                ..Default::default()
            };
            original.positions[0].virtual_scaled = frozen.claims[0];
            original.book.last_order_id = 100;
            original.book.last_group_id = 200;
            let mut words = pages.words();
            let graph = GraphPages {
                layout: Layout::new(count).unwrap(),
                store: &mut words,
            };
            let mut flow = graph.flow(ordinal).unwrap();
            let request = settlement_application_pages(&header, &plan).unwrap();
            let increments = pages.execute(&header, &plan, request, |window| {
                let graph = GraphPages {
                    layout: Layout::new(count).unwrap(),
                    store: window,
                };
                arc_indices(count, ordinal)
                    .unwrap()
                    .map(|index| graph.arc(index).unwrap().capacity)
            });
            let before = plan.work.bytes;
            let mut wrong = flow;
            wrong.seen_attempt += 1;
            assert!(
                apply_margin(&header, &mut plan, frozen, &original, &mut wrong, increments)
                    .is_err()
            );
            assert_eq!(plan.work.bytes, before);
            let mut next =
                apply_margin(&header, &mut plan, frozen, &original, &mut flow, increments).unwrap();
            assert_eq!(next.cash, u64::from(ordinal == 1));
            assert!(flow.applied);
            assert_eq!(plan.original_cash_remaining, 0);
            assert_eq!(plan.cash_applied, u64::from(ordinal >= 1));
            assert!(
                apply_margin(&header, &mut plan, frozen, &original, &mut flow, increments).is_err()
            );
            next.revision += 1;
            roots.push(next);
            final_flows.push(flow);
            round_trip(&mut plan);
            if ordinal + 1 < count {
                assert!(application_scan(&header, &plan).unwrap().result().is_err());
            }
        }
        assert_eq!(
            application_scan(&header, &plan).unwrap().result().unwrap(),
            1
        );
        let scan = SnapshotScan::new(application_binding(&header, &plan).after().unwrap()).unwrap();
        plan.stage = PLAN_RECONCILE;
        plan.cursor = 0;
        save(&mut plan, &scan.checkpoint());
        let mut safety = VenueSafety {
            mode: FROZEN,
            paused: true,
            epoch: 27,
            ..Default::default()
        };
        assert!(complete(&header, &mut plan, &mut source, &mut safety).is_err());
        for ordinal in 0..count {
            let root = &mut roots[ordinal as usize];
            root.cash += 1;
            assert!(reconcile_margin(
                &header,
                &mut plan,
                &rows[ordinal as usize],
                root,
                final_flows[ordinal as usize]
            )
            .is_err());
            root.cash -= 1;
            reconcile_margin(
                &header,
                &mut plan,
                &rows[ordinal as usize],
                root,
                final_flows[ordinal as usize],
            )
            .unwrap();
            round_trip(&mut plan);
        }
        complete(&header, &mut plan, &mut source, &mut safety).unwrap();
        assert_eq!(
            (source.stage, source.cursor, source.cash_applied),
            (11, count as u64, 1)
        );
        assert_eq!(
            (safety.mode, safety.paused, safety.epoch),
            (RESOLVED, false, 28)
        );
        assert_eq!(plan.stage, PLAN_COMPLETE);
        assert!(complete(&header, &mut plan, &mut source, &mut safety).is_err());
    }
}

#[test]
fn borrowed_margin_event_has_exact_owned_encoding() {
    let root = MarginAccount {
        cash: 29,
        revision: 7,
        ..Default::default()
    };
    let view = AppliedView {
        venue: Address::new_unique(),
        slot: 3,
        epoch: 5,
        ordinal: 7,
        id: u64::MAX - 1,
        member: Address::new_unique(),
        cash_before: 31,
        claims: [-13, 19],
        lots: [-7, 11],
        flows: [17, 23],
        state: &root,
    };
    let owned = crate::events::SettlementMarginApplied {
        venue: view.venue,
        slot: view.slot,
        epoch: view.epoch,
        ordinal: view.ordinal,
        id: view.id,
        member: view.member,
        cash_before: view.cash_before,
        claims: view.claims,
        lots: view.lots,
        flows: view.flows,
        state: crate::events::MarginAccountSnapshot::from(&root),
    };
    let (mut actual, mut expected) = (Vec::new(), Vec::new());
    crate::wire::write(&view, &mut actual).unwrap();
    crate::wire::write(&owned, &mut expected).unwrap();
    assert_eq!(actual, expected);
}

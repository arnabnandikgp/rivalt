use super::*;
use crate::test_support::TestAccount;
use anchor_lang::AccountDeserialize;
use financial_core::{
    clearing::scalable::{
        graph_work::GraphStorage, insurance_rounds::InsuranceRounds, rate_work::RateWork,
    },
    SCALE,
};
use std::collections::BTreeMap;

pub(super) struct Words(BTreeMap<(u32, u64), u64>);
impl LimbStorage for Words {
    fn read(&self, register: u32, limb: u64) -> financial_core::Result<u64> {
        Ok(*self.0.get(&(register, limb)).unwrap_or(&u64::MAX))
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> financial_core::Result<()> {
        self.0.insert((register, limb), value);
        Ok(())
    }
}
pub(super) struct Pages {
    bytes: BTreeMap<(u32, u64), (Address, Vec<u8>)>,
}
impl Pages {
    fn new(header: &PreparedSettlement, rates: &SettlementRates, words: &Words) -> Self {
        let layout = Layout::new(header.count).unwrap();
        let mut pages = Self {
            bytes: BTreeMap::new(),
        };
        for register in (0..=45).chain(64..=70) {
            let capacity = layout.capacity(register).unwrap();
            for index in 0..capacity.div_ceil(PAGE_WORDS) {
                let (address, bump) = find_program_address(
                    &[
                        b"resolution-limbs",
                        header.venue.as_ref(),
                        &register.to_le_bytes(),
                        &index.to_le_bytes(),
                    ],
                    &crate::ID,
                );
                let mut page = SettlementLimbPage {
                    schema_version: crate::state::accounts::SCHEMA_VERSION,
                    revision: 1,
                    venue: header.venue,
                    epoch: header.epoch,
                    attempt: if register <= 1 { 0 } else { rates.attempt },
                    register,
                    page_index: index,
                    word_count: (capacity - index * 256).min(256) as u16,
                    bump,
                    ..Default::default()
                };
                for (offset, word) in page.payload.words.iter_mut().enumerate() {
                    *word = words.read(register, index * 256 + offset as u64).unwrap();
                }
                let mut bytes = Vec::new();
                crate::wire::write_discriminated(&page, &mut bytes).unwrap();
                pages.bytes.insert((register, index), (address, bytes));
            }
        }
        pages
    }
    pub(super) fn execute<T>(
        &mut self,
        header: &PreparedSettlement,
        plan: &SettlementPlan,
        request: PagePlan,
        run: impl FnOnce(&mut PageWindow<'_>) -> T,
    ) -> T {
        let mut revisions = [0; 3];
        let mut backing: Vec<_> = request
            .requests()
            .iter()
            .enumerate()
            .map(|(index, page)| {
                let (address, bytes) = &self.bytes[&(page.register, page.index)];
                revisions[index] = u64::from_le_bytes(bytes[10..18].try_into().unwrap());
                TestAccount::new(*address, crate::ID, bytes, page.writable, false)
            })
            .collect();
        let mut views: Vec<_> = backing.iter_mut().map(TestAccount::view).collect();
        let mut window = window(header, plan, request, revisions, &mut views).unwrap();
        let result = run(&mut window);
        window.commit().unwrap();
        for (index, page) in request.requests().iter().enumerate() {
            self.bytes.get_mut(&(page.register, page.index)).unwrap().1 =
                views[index].try_borrow().unwrap().to_vec();
        }
        result
    }
    pub(super) fn words(&self) -> Words {
        let mut result = Words(BTreeMap::new());
        for ((register, index), (_, bytes)) in &self.bytes {
            for offset in 0..256 {
                result.0.insert(
                    (*register, index * 256 + offset),
                    u64::from_le_bytes(
                        bytes[81 + offset as usize * 8..89 + offset as usize * 8]
                            .try_into()
                            .unwrap(),
                    ),
                );
            }
        }
        result
    }
}

/// Literal financial case: one debtor has 1 atom against 2 atoms of BTC debt;
/// two equal creditors each own 1 BTC-claim atom. Rate is 1/2, each exact payout
/// is 1/2 atom, and canonical stable-ID ordering awards the single atom to ID 1.
/// Added roots have no claims/cash and must still appear exactly once per order.
pub(super) fn fixture(
    count: u64,
) -> (
    PreparedSettlement,
    SettlementRates,
    SettlementPlan,
    Vec<FrozenMargin>,
    Pages,
) {
    let mut header = PreparedSettlement {
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        revision: 10,
        venue: Address::new_unique(),
        epoch: 17,
        count,
        allocated: 1,
        stage: PROPOSAL,
        ..Default::default()
    };
    let rows: Vec<_> = (0..count)
        .map(|id| FrozenMargin {
            id,
            cash: u64::from(id == 0),
            claims: [
                match id {
                    0 => -2 * SCALE,
                    1 | 2 => SCALE,
                    _ => 0,
                },
                0,
            ],
            ..Default::default()
        })
        .collect();
    let mut scan = SnapshotScan::new(snapshot_binding(&header)).unwrap();
    for (index, row) in rows.iter().enumerate() {
        scan.accept(
            index as u64,
            row.id,
            &Row {
                cash: row.cash,
                claims: row.claims,
            },
            [0; 2],
        )
        .unwrap();
    }
    scan.result().unwrap();
    header.state.valuation = scan.checkpoint();
    let mut words = Words(BTreeMap::new());
    let mut denominator = DenominatorPass::new(count, required_limbs(count).unwrap()).unwrap();
    while !denominator.is_done() {
        if let Ok(index) = denominator.row_index() {
            let row = &rows[index as usize];
            denominator
                .accept(
                    index,
                    row.id,
                    &Row {
                        cash: row.cash,
                        claims: row.claims,
                    },
                )
                .unwrap();
        } else {
            denominator.step(&mut words).unwrap();
        }
    }
    header.state.denominator = denominator.checkpoint();
    let (register, used) = denominator.result().unwrap();
    assert_eq!(used, 1);
    let common = words.read(register, 0).unwrap();
    words.write(3, 0, common).unwrap();
    words.write(4, 0, 2 * common).unwrap();
    let mut rounds = InsuranceRounds::new([0; 2]).unwrap();
    let mut rates = SettlementRates {
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        revision: 12,
        venue: header.venue,
        epoch: 17,
        attempt: 3,
        stage: VERIFY_RATE,
        factor: [2, 0, 0, 0, 0],
        lengths: [1; 2],
        ..Default::default()
    };
    rates.state.insurance = rounds.checkpoint();
    let mut work = RateWork::new(super::super::rates::input(&header, &rates).unwrap()).unwrap();
    while !work.is_done() {
        if let Ok(index) = work.row_index() {
            let row = &rows[index as usize];
            work.accept(
                index,
                row.id,
                Row {
                    cash: row.cash,
                    claims: row.claims,
                },
            )
            .unwrap();
        } else {
            work.step(&mut words).unwrap();
        }
    }
    assert_eq!(work.result().unwrap().spent, [0; 2]);
    rounds.accept(work.result().unwrap()).unwrap();
    rates.state.work = work.checkpoint();
    rates.state.insurance = rounds.checkpoint();
    rates.stage = VERIFIED_RATE;
    let plan = SettlementPlan {
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        venue: header.venue,
        epoch: 17,
        rates_revision: 12,
        rates_attempt: 3,
        original_cash_remaining: 1,
        ..Default::default()
    };
    let pages = Pages::new(&header, &rates, &words);
    (header, rates, plan, rows, pages)
}
pub(super) fn round_trip(plan: &mut SettlementPlan) {
    let mut bytes = Vec::new();
    crate::wire::write_discriminated(plan, &mut bytes).unwrap();
    assert_eq!(bytes.len(), 1181);
    assert_eq!(
        &bytes[..8],
        &solana_sha256_hasher::hash(b"account:SettlementPlan").to_bytes()[..8]
    );
    assert_eq!(8 + SettlementPlan::INIT_SPACE, 1181);
    *plan = SettlementPlan::try_deserialize(&mut bytes.as_slice()).unwrap();
}
pub(super) fn advance(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &mut SettlementPlan,
    pages: &mut Pages,
    budget: u16,
) {
    let layout = Layout::new(header.count).unwrap();
    let request = settlement_plan_pages(header, rates, plan).unwrap();
    let mut work = Work::restore(header, rates, plan).unwrap();
    let steps = pages.execute(header, plan, request, |window| {
        let mut progressed = 0;
        for _ in 0..budget {
            let Ok(accesses) = work.accesses(layout) else {
                break;
            };
            if !window.covers(accesses) {
                break;
            }
            work.step(layout, window).unwrap();
            progressed += 1;
        }
        progressed
    });
    assert!(steps > 0);
    work.save(header, rates, plan).unwrap();
    round_trip(plan);
}
pub(super) fn accept(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &mut SettlementPlan,
    rows: &[FrozenMargin],
    pages: &mut Pages,
    ordinal: u64,
) -> Result<()> {
    let request = settlement_plan_row_pages(header, rates, plan, ordinal)?;
    let values = binding(header, rates, plan)?;
    let actor = plan.proposer;
    // Account request is captured before the controller mutates the checkpoint.
    let mut snapshot = SettlementPlan::default();
    snapshot.rates_attempt = plan.rates_attempt;
    pages.execute(header, &snapshot, request, |window| {
        accept_row(
            header,
            rates,
            plan,
            values,
            ordinal,
            rows[ordinal as usize].clone(),
            actor,
            99,
            &mut GraphPages {
                layout: Layout::new(header.count).unwrap(),
                store: window,
            },
        )
    })
}
pub(super) fn flows(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &mut SettlementPlan,
    rows: &[FrozenMargin],
    pages: &mut Pages,
    budget: u16,
) {
    for ordinal in 0..header.count {
        assert_eq!(plan.stage, PLAN_FLOW_AWAIT);
        assert!(settlement_plan_row_pages(header, rates, plan, ordinal + 1).is_err());
        accept(header, rates, plan, rows, pages, ordinal).unwrap();
        while plan.stage == PLAN_FLOW_WORK {
            advance(header, rates, plan, pages, budget);
        }
        assert_eq!(plan.stage, PLAN_FLOW_STORE);
        accept(header, rates, plan, rows, pages, ordinal).unwrap();
        round_trip(plan);
    }
    assert_eq!(plan.stage, PLAN_ORDER_AWAIT);
}
pub(super) fn begin_order(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &mut SettlementPlan,
) {
    start_order(
        header,
        rates,
        plan,
        plan.revision,
        Address::new_unique(),
        99,
    )
    .unwrap();
}

#[test]
fn owned_controller_and_real_page_adapter_conserve_literal_atoms_across_restarts_and_page_boundaries(
) {
    for (count, budget) in [(3, 1), (3, 7), (65, 128)] {
        let (header, rates, mut plan, rows, mut pages) = fixture(count);
        flows(&header, &rates, &mut plan, &rows, &mut pages, budget);
        begin_order(&header, &rates, &mut plan);
        for market in 0..2 {
            for ordinal in 0..count {
                assert_eq!(plan.stage, PLAN_ORDER_WORK);
                assert_eq!(plan.order_market, market);
                accept(&header, &rates, &mut plan, &rows, &mut pages, ordinal).unwrap();
                while plan.stage == PLAN_ORDER_WORK
                    && plan.order_market == market
                    && order(&plan, binding(&header, &rates, &plan).unwrap())
                        .unwrap()
                        .position()
                        .is_err()
                {
                    advance(&header, &rates, &mut plan, &mut pages, budget);
                }
                round_trip(&mut plan);
            }
        }
        assert_eq!(plan.stage, PLAN_BUILD);
        while plan.stage != PLAN_READY {
            advance(&header, &rates, &mut plan, &mut pages, budget);
        }
        assert!(settlement_plan_pages(&header, &rates, &plan).is_err());
        assert!(settlement_plan_row_pages(&header, &rates, &plan, 0).is_err());
        let mut words = pages.words();
        let graph = GraphPages {
            layout: Layout::new(count).unwrap(),
            store: &mut words,
        };
        for ordinal in 0..count {
            let row = graph.flow(ordinal).unwrap();
            assert_eq!(row.seen_attempt, 1);
            assert_eq!(row.seen_mask, 3);
            assert!(!row.applied);
            let amount = row.whole[2] + graph.arc(2 * (2 * count + ordinal) + 1).unwrap().capacity;
            assert_eq!(amount, u64::from(ordinal == 1));
        }
    }
}

#[test]
fn owned_order_rejects_duplicate_tie_reversal_and_stale_verification_binding() {
    let (header, mut rates, mut plan, rows, mut pages) = fixture(3);
    rates.revision += 1;
    assert!(binding(&header, &rates, &plan).is_err());
    rates.revision -= 1;
    rates.stage = VERIFY_RATE;
    assert!(binding(&header, &rates, &plan).is_err());
    rates.stage = VERIFIED_RATE;
    let insurance = rates.state.insurance;
    rates.state.insurance = InsuranceRounds::new([0; 2]).unwrap().checkpoint();
    assert!(binding(&header, &rates, &plan).is_err());
    rates.state.insurance = insurance;
    flows(&header, &rates, &mut plan, &rows, &mut pages, 128);
    begin_order(&header, &rates, &mut plan);
    accept(&header, &rates, &mut plan, &rows, &mut pages, 0).unwrap();
    let before = plan.work.bytes;
    assert!(accept(&header, &rates, &mut plan, &rows, &mut pages, 0).is_err());
    assert_eq!(plan.work.bytes, before);
    for ordinal in [2, 1] {
        accept(&header, &rates, &mut plan, &rows, &mut pages, ordinal).unwrap();
        while plan.stage == PLAN_ORDER_WORK
            && order(&plan, binding(&header, &rates, &plan).unwrap())
                .unwrap()
                .position()
                .is_err()
        {
            advance(&header, &rates, &mut plan, &mut pages, 128);
        }
    }
    assert_eq!(plan.stage, PLAN_ORDER_REJECTED);
    assert!(settlement_plan_pages(&header, &rates, &plan).is_err());
    // A new owned attempt lazily clears old seen bits without rewriting floors.
    let resetter = Address::new_unique();
    reset_order(&mut plan, 0, 1, resetter, 99).unwrap();
    begin_order(&header, &rates, &mut plan);
    accept(&header, &rates, &mut plan, &rows, &mut pages, 0).unwrap();
    assert_eq!(plan.order_attempt, 2);
    let mut words = pages.words();
    let graph = GraphPages {
        layout: Layout::new(3).unwrap(),
        store: &mut words,
    };
    assert_eq!(graph.flow(0).unwrap().seen_attempt, 2);
    assert_eq!(graph.flow(0).unwrap().seen_mask, 1);
}

#[test]
fn order_recovery_is_revision_attempt_and_progress_fenced_and_stops_at_construction() {
    let (header, rates, mut plan, rows, mut pages) = fixture(3);
    let stranger = Address::new_unique();
    assert!(start_order(&header, &rates, &mut plan, 0, stranger, 99).is_err());
    flows(&header, &rates, &mut plan, &rows, &mut pages, 128);
    begin_order(&header, &rates, &mut plan);
    let before = plan.work.bytes;
    assert!(reset_order(&mut plan, 1, 1, stranger, 163).is_err());
    assert!(reset_order(&mut plan, 0, 2, stranger, 163).is_err());
    assert!(reset_order(&mut plan, 0, 1, stranger, 162).is_err());
    assert_eq!(plan.work.bytes, before);
    reset_order(&mut plan, 0, 1, stranger, 163).unwrap();
    assert_eq!(plan.stage, PLAN_ORDER_AWAIT);
    assert_eq!(plan.insurance_spent, [0; 2]);
    assert_eq!(plan.original_cash_remaining, 1);
    begin_order(&header, &rates, &mut plan);
    let owner = plan.proposer;
    reset_order(&mut plan, 0, 2, owner, 99).unwrap();
    for stage in [
        PLAN_FLOW_AWAIT,
        PLAN_FLOW_WORK,
        PLAN_FLOW_STORE,
        PLAN_ORDER_AWAIT,
        PLAN_BUILD,
        PLAN_CIRCULATE,
        PLAN_READY,
    ] {
        plan.stage = stage;
        assert!(reset_order(&mut plan, 0, 2, owner, 1_000).is_err());
    }
}

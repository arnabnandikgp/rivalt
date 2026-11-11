//! Exclusive plan adoption and bounded financial application. No caller supplies
//! payouts: terminal graph records and the frozen root determine every amount.
use super::application::{applied_margin, reconciled_margin};
use super::*;
use crate::instructions::account_custody::increment;
use financial_core::clearing::scalable::{
    application::{ApplicationBinding, ApplicationScan},
    graph_pages::FLOWS,
    graph_work::GraphStorage,
};

/// Legacy resolution deliberately does not accept this stage in frozen().
pub const PAGED_APPLY: u8 = 14;
pub const PLAN_APPLY: u8 = 9;
pub const PLAN_RECONCILE: u8 = 10;
pub const PLAN_RECONCILED: u8 = 11;
pub const PLAN_COMPLETE: u8 = 12;

fn application_binding(header: &PreparedSettlement, plan: &SettlementPlan) -> ApplicationBinding {
    ApplicationBinding {
        snapshot: snapshot_binding(header),
        insurance_spent: plan.insurance_spent,
    }
}
fn application_scan(header: &PreparedSettlement, plan: &SettlementPlan) -> Result<ApplicationScan> {
    require!(plan.stage == PLAN_APPLY, ClearingError::Resolution);
    let scan = exact(ApplicationScan::from_checkpoint(
        checkpoint(plan, 368)?,
        application_binding(header, plan),
    ))?;
    let (original, cash, movements) = scan.progress();
    require!(
        original.processed == plan.cursor
            && cash == plan.cash_applied
            && movements == plan.market_movements
            && totals(header)?.checked_sub(original.cash) == Some(plan.original_cash_remaining),
        ClearingError::Reconciliation
    );
    Ok(scan)
}
fn remaining_gross(header: &PreparedSettlement, scan: &ApplicationScan) -> Result<[u64; 2]> {
    let progress = scan.progress().0;
    Ok([
        header.gross[0]
            .checked_sub(progress.gross[0])
            .ok_or(ClearingError::Reconciliation)?,
        header.gross[1]
            .checked_sub(progress.gross[1])
            .ok_or(ClearingError::Reconciliation)?,
    ])
}
fn adopted(
    source: &FrozenSource<'_>,
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &SettlementPlan,
    revision: u64,
) -> Result<()> {
    binding(header, rates, plan)?;
    require!(plan.revision == revision, ClearingError::Resolution);
    let gross = if plan.stage == PLAN_APPLY {
        remaining_gross(header, &application_scan(header, plan)?)?
    } else {
        require!(
            [PLAN_RECONCILE, PLAN_RECONCILED].contains(&plan.stage),
            ClearingError::Resolution
        );
        [0; 2]
    };
    source.adopted(header, plan, gross, plan.stage != PLAN_APPLY)
}

fn adopt(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &mut SettlementPlan,
    source: &mut Resolution,
    revision: u64,
) -> Result<()> {
    binding(header, rates, plan)?;
    require!(
        plan.revision == revision
            && plan.stage == PLAN_READY
            && plan.adoption_revision == 0
            && plan.cursor == header.count
            && source.stage == super::super::super::resolution::VALUE
            && source.cursor == 0
            && source.revision == header.source_revision,
        ClearingError::Resolution
    );
    let graph = exact(GraphWork::from_checkpoint(
        checkpoint(plan, 352)?,
        header.count,
        plan.graph_length,
        plan.graph_required,
    ))?;
    require!(graph.is_done(), ClearingError::Resolution);
    let scan = exact(ApplicationScan::new(application_binding(header, plan)))?;
    let adoption_revision = source
        .revision
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    source.stage = PAGED_APPLY;
    plan.adoption_revision = adoption_revision;
    plan.stage = PLAN_APPLY;
    plan.cursor = 0;
    plan.original_cash_remaining = totals(header)?;
    plan.cash_applied = 0;
    plan.market_movements = [0; 2];
    save(plan, &scan.checkpoint());
    Ok(())
}
pub fn adopt_plan(
    ctx: &mut Context<AdoptSettlementPlan>,
    events: &mut crate::event_cpi::Payloads,
    _epoch: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    adopt(
        &accounts.prepared,
        &accounts.rates,
        &mut accounts.plan,
        &mut accounts.source.resolution,
        revision,
    )?;
    accounts.plan.last_progress_slot = Clock::get()?.slot;
    emit_progress(
        &accounts.source.frozen(),
        &accounts.plan,
        *accounts.plan.address(),
        events,
        accounts.event_authority.account().clone(),
    )
}

fn arc_indices(count: u64, ordinal: u64) -> Result<[u64; 3]> {
    require!(ordinal < count, ClearingError::Resolution);
    let mut result = [0; 3];
    for (kind, index) in result.iter_mut().enumerate() {
        *index = count
            .checked_mul(kind as u64)
            .and_then(|base| base.checked_add(ordinal))
            .and_then(|edge| edge.checked_mul(2))
            .and_then(|edge| edge.checked_add(1))
            .ok_or(ClearingError::Arithmetic)?;
    }
    Ok(result)
}
pub fn settlement_application_pages(
    header: &PreparedSettlement,
    plan: &SettlementPlan,
) -> Result<PagePlan> {
    require!(
        plan.stage == PLAN_APPLY && plan.cursor < header.count,
        ClearingError::Resolution
    );
    let layout = exact(Layout::new(header.count))?;
    let records = arc_indices(header.count, plan.cursor)?.map(|index| {
        Some(Access {
            record: Record::Arc(index),
            writable: false,
        })
    });
    exact(layout.plan(records))
}
fn flow_offset(
    header: &PreparedSettlement,
    plan: &SettlementPlan,
    page: &SettlementLimbPage,
    ordinal: u64,
) -> Result<usize> {
    let layout = exact(Layout::new(header.count))?;
    let (_, word) = exact(layout.location(Record::Root(ordinal)))?;
    let start = word / PAGE_WORDS * PAGE_WORDS;
    let capacity = exact(layout.capacity(FLOWS))?;
    require!(
        page.schema_version == SETTLEMENT_SCHEMA
            && page.venue == header.venue
            && page.epoch == header.epoch
            && page.attempt == plan.rates_attempt
            && page.register == FLOWS
            && page.page_index == word / PAGE_WORDS
            && u64::from(page.word_count) == (capacity - start).min(PAGE_WORDS)
            && page.revision > 0,
        ClearingError::Resolution
    );
    Ok((word % PAGE_WORDS) as usize)
}
fn stored_flow(
    header: &PreparedSettlement,
    plan: &SettlementPlan,
    page: &SettlementLimbPage,
    ordinal: u64,
) -> Result<FlowRecord> {
    let offset = flow_offset(header, plan, page, ordinal)?;
    exact(FlowRecord::from_words(
        page.payload.words[offset..offset + 7].try_into().unwrap(),
    ))
}
fn apply_margin(
    header: &PreparedSettlement,
    plan: &mut SettlementPlan,
    frozen: &FrozenMargin,
    root: &MarginAccount,
    flow: &mut FlowRecord,
    increments: [u64; 3],
) -> Result<Box<MarginAccount>> {
    require!(
        flow.id == frozen.id && flow.seen_attempt == plan.order_attempt && !flow.applied,
        ClearingError::Resolution
    );
    let mut scan = application_scan(header, plan)?;
    let amounts = exact(scan.accept(
        plan.cursor,
        frozen.id,
        Row {
            cash: frozen.cash,
            claims: frozen.claims,
        },
        frozen.lots,
        *flow,
        increments,
    ))?;
    let next = applied_margin(header, frozen, root, amounts)?;
    let (original, cash, movements) = scan.progress();
    plan.cursor = original.processed;
    plan.original_cash_remaining = totals(header)?
        .checked_sub(original.cash)
        .ok_or(ClearingError::Reconciliation)?;
    plan.cash_applied = cash;
    plan.market_movements = movements;
    save(plan, &scan.checkpoint());
    flow.whole = [amounts.flows[0], amounts.flows[1], amounts.cash];
    flow.applied = true;
    exact(flow.words())?;
    Ok(next)
}
pub fn apply_plan_margin(
    ctx: &mut Context<ApplySettlementMargin>,
    events: &mut crate::event_cpi::Payloads,
    _epoch: u64,
    revision: u64,
    ordinal: u64,
    revisions: [u64; 3],
) -> Result<()> {
    let mut remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    adopted(
        &accounts.source.frozen(),
        &accounts.prepared,
        &accounts.rates,
        &accounts.plan,
        revision,
    )?;
    require!(
        accounts.plan.stage == PLAN_APPLY && accounts.plan.cursor == ordinal,
        ClearingError::Resolution
    );
    let frozen = frozen_row(&accounts.prepared, &accounts.page, ordinal)?;
    require!(
        frozen.member == *accounts.margin.address(),
        ClearingError::Resolution
    );
    let layout = exact(Layout::new(accounts.prepared.count))?;
    let page_plan = settlement_application_pages(&accounts.prepared, &accounts.plan)?;
    let mut window = window(
        &accounts.prepared,
        &accounts.plan,
        page_plan,
        revisions,
        &mut remaining,
    )?;
    let pages = GraphPages {
        layout,
        store: &mut window,
    };
    let mut increments = [0; 3];
    for (kind, index) in arc_indices(accounts.prepared.count, ordinal)?
        .into_iter()
        .enumerate()
    {
        increments[kind] = exact(pages.arc(index))?.capacity;
    }
    let mut flow = stored_flow(
        &accounts.prepared,
        &accounts.plan,
        &accounts.flow_page,
        ordinal,
    )?;
    let next = apply_margin(
        &accounts.prepared,
        &mut accounts.plan,
        &frozen,
        &accounts.margin,
        &mut flow,
        increments,
    )?;
    let offset = flow_offset(
        &accounts.prepared,
        &accounts.plan,
        &accounts.flow_page,
        ordinal,
    )?;
    accounts.flow_page.payload.words[offset..offset + 7].copy_from_slice(&exact(flow.words())?);
    **accounts.margin = *next;
    let gross = remaining_gross(
        &accounts.prepared,
        &application_scan(&accounts.prepared, &accounts.plan)?,
    )?;
    accounts.source.btc.gross_lots = gross[0];
    accounts.source.eth.gross_lots = gross[1];
    accounts.plan.last_progress_slot = Clock::get()?.slot;
    emit_margin(
        &accounts.prepared,
        &accounts.plan,
        ordinal,
        &frozen,
        &flow,
        &accounts.margin,
        events,
        accounts.event_authority.account().clone(),
    )?;
    emit_progress(
        &accounts.source.frozen(),
        &accounts.plan,
        *accounts.plan.address(),
        events,
        accounts.event_authority.account().clone(),
    )
}

pub fn complete_application(
    ctx: &mut Context<CompleteSettlementApplication>,
    events: &mut crate::event_cpi::Payloads,
    _epoch: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    adopted(
        &accounts.source.frozen(),
        &accounts.prepared,
        &accounts.rates,
        &accounts.plan,
        revision,
    )?;
    let total = exact(application_scan(&accounts.prepared, &accounts.plan)?.result())?;
    require!(
        accounts.plan.cursor == accounts.prepared.count
            && accounts.plan.original_cash_remaining == 0
            && accounts.plan.cash_applied == total,
        ClearingError::Reconciliation
    );
    let after = exact(application_binding(&accounts.prepared, &accounts.plan).after())?;
    let scan = exact(SnapshotScan::new(after))?;
    // Both markets commit together, only after all roots and market flows conserve.
    let source = &mut *accounts.source;
    for (market, ledger) in [&mut source.btc_ledger, &mut source.eth_ledger]
        .into_iter()
        .enumerate()
    {
        ledger.settlement = 0;
        ledger.insurance = after.insurance[market];
        increment(&mut ledger.version)?;
        increment(&mut ledger.liability_version)?;
    }
    accounts.plan.stage = PLAN_RECONCILE;
    accounts.plan.cursor = 0;
    save(&mut accounts.plan, &scan.checkpoint());
    accounts.plan.last_progress_slot = Clock::get()?.slot;
    emit_progress(
        &accounts.source.frozen(),
        &accounts.plan,
        *accounts.plan.address(),
        events,
        accounts.event_authority.account().clone(),
    )
}
fn reconcile_margin(
    header: &PreparedSettlement,
    plan: &mut SettlementPlan,
    frozen: &FrozenMargin,
    root: &MarginAccount,
    flow: FlowRecord,
) -> Result<()> {
    require!(
        plan.stage == PLAN_RECONCILE
            && flow.applied
            && flow.id == frozen.id
            && flow.seen_attempt == plan.order_attempt
            && flow.cash == frozen.cash
            && flow.directions == frozen.claims.map(|claim| claim.signum() as i8),
        ClearingError::Resolution
    );
    reconciled_margin(header, frozen, root, flow.whole[2])?;
    let mut scan = exact(SnapshotScan::from_checkpoint(
        checkpoint(plan, 288)?,
        exact(application_binding(header, plan).after())?,
    ))?;
    require!(
        scan.next().ok() == Some(plan.cursor),
        ClearingError::Resolution
    );
    exact(scan.accept(
        plan.cursor,
        frozen.id,
        &Row {
            cash: root.cash,
            claims: [0; 2],
        },
        [0; 2],
    ))?;
    plan.cursor = scan.progress().processed;
    if plan.cursor == header.count {
        require!(
            exact(scan.result())?.cash == plan.cash_applied,
            ClearingError::Reconciliation
        );
        plan.stage = PLAN_RECONCILED;
    }
    save(plan, &scan.checkpoint());
    Ok(())
}
pub fn reconcile_plan_margin(
    ctx: &mut Context<ReconcileSettlementMargin>,
    events: &mut crate::event_cpi::Payloads,
    _epoch: u64,
    revision: u64,
    ordinal: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    adopted(
        &accounts.source.frozen(),
        &accounts.prepared,
        &accounts.rates,
        &accounts.plan,
        revision,
    )?;
    require!(accounts.plan.cursor == ordinal, ClearingError::Resolution);
    let frozen = frozen_row(&accounts.prepared, &accounts.page, ordinal)?;
    require!(
        frozen.member == *accounts.margin.address(),
        ClearingError::Resolution
    );
    let flow = stored_flow(
        &accounts.prepared,
        &accounts.plan,
        &accounts.flow_page,
        ordinal,
    )?;
    reconcile_margin(
        &accounts.prepared,
        &mut accounts.plan,
        &frozen,
        &accounts.margin,
        flow,
    )?;
    accounts.plan.last_progress_slot = Clock::get()?.slot;
    emit_progress(
        &accounts.source.frozen(),
        &accounts.plan,
        *accounts.plan.address(),
        events,
        accounts.event_authority.account().clone(),
    )
}
fn complete(
    header: &PreparedSettlement,
    plan: &mut SettlementPlan,
    source: &mut Resolution,
    safety: &mut VenueSafety,
) -> Result<()> {
    require!(
        plan.stage == PLAN_RECONCILED && plan.cursor == header.count,
        ClearingError::Resolution
    );
    let scan = exact(SnapshotScan::from_checkpoint(
        checkpoint(plan, 288)?,
        exact(application_binding(header, plan).after())?,
    ))?;
    require!(
        exact(scan.result())?.cash == plan.cash_applied
            && plan.original_cash_remaining == 0
            && plan.market_movements == budgets(header, plan)?.map(i128::from),
        ClearingError::Reconciliation
    );
    let next_epoch = safety
        .epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    source.stage = super::super::super::resolution::COMPLETE;
    source.cursor = source.count;
    source.cash_applied = plan.cash_applied;
    source.scanned_cash = plan.cash_applied;
    source.remaining_lots = [0; 2];
    source.remaining_gross = [0; 2];
    source.remaining_claims = [0; 2];
    source.insurance_spent = plan.insurance_spent;
    source.budgets = budgets(header, plan)?;
    for market in 0..2 {
        source.claim_sums[market] = plan.market_movements[market]
            .checked_mul(financial_core::SCALE)
            .ok_or(ClearingError::Arithmetic)?;
    }
    source.safety_epoch = next_epoch;
    safety.epoch = next_epoch;
    safety.mode = RESOLVED;
    safety.paused = false;
    plan.stage = PLAN_COMPLETE;
    Ok(())
}
pub fn complete_plan(
    ctx: &mut Context<CompleteSettlementPlan>,
    events: &mut crate::event_cpi::Payloads,
    _epoch: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    adopted(
        &accounts.source.frozen(),
        &accounts.prepared,
        &accounts.rates,
        &accounts.plan,
        revision,
    )?;
    let source = &mut *accounts.source;
    complete(
        &accounts.prepared,
        &mut accounts.plan,
        &mut source.resolution,
        &mut source.safety,
    )?;
    accounts.plan.last_progress_slot = Clock::get()?.slot;
    emit_progress(
        &accounts.source.frozen(),
        &accounts.plan,
        *accounts.plan.address(),
        events,
        accounts.event_authority.account().clone(),
    )
}

fn emit_progress(
    source: &FrozenSource<'_>,
    plan: &SettlementPlan,
    key: Address,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountView,
) -> Result<()> {
    events.emit(
        &crate::events::SettlementPlanProgress {
            venue: plan.venue,
            slot: plan.last_progress_slot,
            epoch: plan.epoch,
            plan: key,
            stage: plan.stage,
            cursor: plan.cursor,
            count: u64::from(source.source.count),
            adoption_revision: plan.adoption_revision,
            remaining_cash: plan.original_cash_remaining,
            applied_cash: plan.cash_applied,
            market_movements: plan.market_movements,
            gross: source.markets.map(|market| market.gross_lots),
            pools: source.ledgers.map(|ledger| ledger.settlement),
            insurance: source.ledgers.map(|ledger| ledger.insurance),
            insurance_spent: plan.insurance_spent,
            fees: source.ledgers.map(|ledger| ledger.fees),
            ledger_versions: source.ledgers.map(|ledger| ledger.version),
            liability_versions: source.ledgers.map(|ledger| ledger.liability_version),
            insurance_fee_remainders: source.ledgers.map(|ledger| ledger.insurance_fee_remainder),
            allocated: source.custody.allocated_vault,
            actual_vault: source.actual_vault,
            resolution_stage: source.source.stage,
            mode: source.safety.mode,
            paused: source.safety.paused,
            safety_epoch: source.safety.epoch,
        },
        authority,
    )
}
#[derive(AnchorSerialize)]
struct AppliedView<'a> {
    venue: Address,
    slot: u64,
    epoch: u64,
    ordinal: u64,
    id: u64,
    member: Address,
    cash_before: u64,
    claims: [i128; 2],
    lots: [i64; 2],
    flows: [u64; 2],
    state: &'a MarginAccount,
}
#[inline(never)]
fn emit_margin(
    header: &PreparedSettlement,
    plan: &SettlementPlan,
    ordinal: u64,
    frozen: &FrozenMargin,
    flow: &FlowRecord,
    root: &MarginAccount,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountView,
) -> Result<()> {
    events.emit_borrowed::<crate::events::SettlementMarginApplied, _>(
        &AppliedView {
            venue: header.venue,
            slot: plan.last_progress_slot,
            epoch: header.epoch,
            ordinal,
            id: frozen.id,
            member: frozen.member,
            cash_before: frozen.cash,
            claims: frozen.claims,
            lots: frozen.lots,
            flows: [flow.whole[0], flow.whole[1]],
            state: root,
        },
        authority,
    )
}

#[cfg(test)]
mod tests;

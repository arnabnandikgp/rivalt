//! Owner-derived flow/order/graph transitions. No financial account is writable
//! here, and READY alone is not permission to mutate margin accounts.
use super::*;
use crate::instructions::account_safety::settlement_pages::{PageVersion, PageWindow};
use financial_core::clearing::scalable::{
    flow_work::FlowWork,
    graph_build::GraphBuild,
    graph_pages::{FlowRecord, GraphPages, Layout},
    graph_work::{Access, GraphWork, Record},
    order_work::OrderWork,
    pages::{PagePlan, PAGE_WORDS},
    rate_work::VerifiedRateValues,
    wide::{LimbStorage, WordAccess},
};

pub const PLAN_FLOW_AWAIT: u8 = 0;
pub const PLAN_FLOW_WORK: u8 = 1;
pub const PLAN_FLOW_STORE: u8 = 2;
pub const PLAN_ORDER_AWAIT: u8 = 3;
pub const PLAN_ORDER_WORK: u8 = 4;
pub const PLAN_ORDER_REJECTED: u8 = 5;
pub const PLAN_BUILD: u8 = 6;
pub const PLAN_CIRCULATE: u8 = 7;
pub const PLAN_READY: u8 = 8;

fn exact<T>(value: financial_core::Result<T>) -> Result<T> {
    value.map_err(|_| ClearingError::Resolution.into())
}
fn save(plan: &mut SettlementPlan, bytes: &[u8]) {
    plan.work.bytes.fill(0);
    plan.work.bytes[..bytes.len()].copy_from_slice(bytes);
}
fn checkpoint(plan: &SettlementPlan, length: usize) -> Result<&[u8]> {
    require!(
        plan.work.bytes[length..].iter().all(|byte| *byte == 0),
        ClearingError::Resolution
    );
    Ok(&plan.work.bytes[..length])
}
fn binding(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &SettlementPlan,
) -> Result<VerifiedRateValues> {
    require!(
        plan.schema_version == SETTLEMENT_SCHEMA
            && plan.venue == header.venue
            && plan.epoch == header.epoch
            && plan.rates_revision == rates.revision
            && plan.rates_attempt == rates.attempt,
        ClearingError::Resolution
    );
    let (values, spent) = verified_rates(header, rates)?;
    require!(spent == plan.insurance_spent, ClearingError::Resolution);
    Ok(values)
}
fn totals(header: &PreparedSettlement) -> Result<u64> {
    Ok(exact(
        SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
            .and_then(|scan| scan.result()),
    )?
    .cash)
}
fn budgets(header: &PreparedSettlement, plan: &SettlementPlan) -> Result<[u64; 2]> {
    Ok([
        header.pools[0]
            .checked_add(plan.insurance_spent[0])
            .ok_or(ClearingError::Arithmetic)?,
        header.pools[1]
            .checked_add(plan.insurance_spent[1])
            .ok_or(ClearingError::Arithmetic)?,
    ])
}
fn flow(plan: &SettlementPlan, values: VerifiedRateValues) -> Result<FlowWork> {
    let work = exact(FlowWork::from_checkpoint(checkpoint(plan, 768)?, values))?;
    require!(work.identity().0 == plan.cursor, ClearingError::Resolution);
    Ok(work)
}
fn order(plan: &SettlementPlan, values: VerifiedRateValues) -> Result<OrderWork> {
    require!(plan.order_attempt > 0, ClearingError::Resolution);
    exact(OrderWork::from_checkpoint(
        checkpoint(plan, 576)?,
        values,
        usize::from(plan.order_market),
    ))
}

enum Work {
    Flow(FlowWork),
    Order(OrderWork),
    Build(GraphBuild),
    Circulate(GraphWork),
}
impl Work {
    #[inline(never)]
    fn restore(
        header: &PreparedSettlement,
        rates: &SettlementRates,
        plan: &SettlementPlan,
    ) -> Result<Self> {
        let values = binding(header, rates, plan)?;
        Ok(match plan.stage {
            PLAN_FLOW_WORK => Self::Flow(flow(plan, values)?),
            PLAN_ORDER_WORK => Self::Order(order(plan, values)?),
            PLAN_BUILD => Self::Build(exact(GraphBuild::from_checkpoint(
                checkpoint(plan, 384)?,
                header.count,
                totals(header)?,
                budgets(header, plan)?,
            ))?),
            PLAN_CIRCULATE => Self::Circulate(exact(GraphWork::from_checkpoint(
                checkpoint(plan, 352)?,
                header.count,
                plan.graph_length,
                plan.graph_required,
            ))?),
            _ => return Err(ClearingError::Resolution.into()),
        })
    }
    fn accesses(&self, layout: Layout) -> Result<[Option<WordAccess>; 3]> {
        match self {
            Self::Flow(work) => exact(work.accesses()),
            Self::Order(work) => exact(work.accesses()),
            Self::Build(work) => exact(layout.accesses(exact(work.accesses())?)),
            Self::Circulate(work) => exact(layout.accesses(exact(work.accesses())?)),
        }
    }
    fn step(&mut self, layout: Layout, window: &mut impl LimbStorage) -> Result<()> {
        match self {
            Self::Flow(work) => exact(work.step(window)),
            Self::Order(work) => exact(work.step(window)),
            Self::Build(work) => exact(work.step(&mut GraphPages {
                layout,
                store: window,
            })),
            Self::Circulate(work) => exact(work.step(&mut GraphPages {
                layout,
                store: window,
            })),
        }
    }
    fn save(
        &self,
        header: &PreparedSettlement,
        rates: &SettlementRates,
        plan: &mut SettlementPlan,
    ) -> Result<()> {
        match self {
            Self::Flow(work) => {
                save(plan, &work.checkpoint());
                if work.is_done() {
                    plan.stage = PLAN_FLOW_STORE;
                }
            }
            Self::Order(work) => {
                save(plan, &work.checkpoint());
                if work.is_rejected() {
                    plan.stage = PLAN_ORDER_REJECTED;
                } else if work.is_done() {
                    if plan.order_market == 0 {
                        plan.order_market = 1;
                        save(
                            plan,
                            &exact(OrderWork::new(binding(header, rates, plan)?, 1))?.checkpoint(),
                        );
                    } else {
                        let build = exact(GraphBuild::new(
                            header.count,
                            totals(header)?,
                            budgets(header, plan)?,
                        ))?;
                        save(plan, &build.checkpoint());
                        plan.stage = PLAN_BUILD;
                    }
                }
            }
            Self::Build(work) => {
                save(plan, &work.checkpoint());
                if work.is_done() {
                    (plan.graph_length, plan.graph_required) = exact(work.result())?;
                    let graph = exact(GraphWork::new(
                        header.count,
                        plan.graph_length,
                        plan.graph_required,
                    ))?;
                    save(plan, &graph.checkpoint());
                    plan.stage = PLAN_CIRCULATE;
                }
            }
            Self::Circulate(work) => {
                save(plan, &work.checkpoint());
                if work.is_done() {
                    plan.stage = PLAN_READY;
                }
            }
        }
        Ok(())
    }
}
fn page_plan(accesses: [Option<WordAccess>; 3], layout: Layout) -> Result<PagePlan> {
    let capacity = exact(layout.maximum_capacity())?;
    exact(if accesses.iter().all(Option::is_none) {
        PagePlan::metadata_only(capacity)
    } else {
        PagePlan::next(accesses, capacity)
    })
}
pub fn settlement_plan_pages(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &SettlementPlan,
) -> Result<PagePlan> {
    let layout = exact(Layout::new(header.count))?;
    page_plan(
        Work::restore(header, rates, plan)?.accesses(layout)?,
        layout,
    )
}
pub fn settlement_plan_row_pages(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &SettlementPlan,
    ordinal: u64,
) -> Result<PagePlan> {
    let values = binding(header, rates, plan)?;
    let layout = exact(Layout::new(header.count))?;
    require!(ordinal < header.count, ClearingError::Resolution);
    let accesses = match plan.stage {
        PLAN_FLOW_AWAIT => {
            require!(ordinal == plan.cursor, ClearingError::Resolution);
            [None; 3]
        }
        PLAN_FLOW_STORE => {
            require!(
                ordinal == plan.cursor && flow(plan, values)?.is_done(),
                ClearingError::Resolution
            );
            exact(layout.accesses([
                Some(Access {
                    record: Record::Root(ordinal),
                    writable: true,
                }),
                None,
                None,
            ]))?
        }
        PLAN_ORDER_WORK => {
            let position = exact(order(plan, values)?.position())?;
            exact(layout.accesses([
                Some(Access {
                    record: Record::Root(ordinal),
                    writable: true,
                }),
                Some(Access {
                    record: Record::Order {
                        market: plan.order_market,
                        position,
                    },
                    writable: true,
                }),
                None,
            ]))?
        }
        _ => return Err(ClearingError::Resolution.into()),
    };
    page_plan(accesses, layout)
}
fn window<'a>(
    header: &PreparedSettlement,
    plan: &SettlementPlan,
    page_plan: PagePlan,
    revisions: [u64; 3],
    accounts: &'a mut [AccountView],
) -> Result<PageWindow<'a>> {
    let length = page_plan.requests().len();
    require!(
        revisions[length..].iter().all(|value| *value == 0),
        ClearingError::Resolution
    );
    let layout = exact(Layout::new(header.count))?;
    let mut capacities = [0; 3];
    let mut versions = [PageVersion {
        attempt: plan.rates_attempt,
        revision: 0,
    }; 3];
    for (index, request) in page_plan.requests().iter().enumerate() {
        versions[index].revision = revisions[index];
        if request.register <= 1 {
            versions[index].attempt = 0;
        }
        capacities[index] = exact(layout.capacity(request.register))?;
    }
    PageWindow::load_bounded(
        &header.venue,
        header.epoch,
        page_plan,
        &versions[..length],
        &capacities[..length],
        accounts,
    )
}

pub fn initialize_plan(ctx: &mut Context<InitializeSettlementPlan>, _epoch: u64) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    let (_, spent) = verified_rates(&accounts.prepared, &accounts.rates)?;
    exact(Layout::new(accounts.prepared.count))?;
    let plan = &mut accounts.plan;
    plan.schema_version = SETTLEMENT_SCHEMA;
    plan.venue = accounts.prepared.venue;
    plan.epoch = accounts.prepared.epoch;
    plan.rates_revision = accounts.rates.revision;
    plan.rates_attempt = accounts.rates.attempt;
    plan.insurance_spent = spent;
    plan.original_cash_remaining = totals(&accounts.prepared)?;
    plan.bump = ctx.bumps.plan;
    Ok(())
}
pub fn initialize_plan_page(
    ctx: &mut Context<InitializeSettlementPlanPage>,
    _epoch: u64,
    register: u32,
    page_index: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    binding(&accounts.prepared, &accounts.rates, &accounts.plan)?;
    require!(
        (25..=45).contains(&register) || (64..=70).contains(&register),
        ClearingError::Resolution
    );
    let capacity = exact(exact(Layout::new(accounts.prepared.count))?.capacity(register))?;
    let start = page_index
        .checked_mul(PAGE_WORDS)
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        start < capacity && accounts.plan.stage <= PLAN_CIRCULATE,
        ClearingError::Resolution
    );
    let page = &mut accounts.page;
    page.schema_version = SETTLEMENT_SCHEMA;
    page.venue = accounts.prepared.venue;
    page.epoch = accounts.prepared.epoch;
    page.attempt = accounts.plan.rates_attempt;
    page.register = register;
    page.page_index = page_index;
    page.word_count = (capacity - start).min(PAGE_WORDS) as u16;
    page.bump = ctx.bumps.page;
    Ok(())
}

fn frozen_row(
    header: &PreparedSettlement,
    page: &FrozenMarginPage,
    ordinal: u64,
) -> Result<FrozenMargin> {
    require!(
        ordinal < header.count
            && page.schema_version == SETTLEMENT_SCHEMA
            && page.venue == header.venue
            && page.epoch == header.epoch
            && page.page_index == ordinal / 8
            && ordinal % 8 < u64::from(page.row_count),
        ClearingError::Resolution
    );
    Ok(page.rows[(ordinal % 8) as usize].clone())
}
pub fn accept_plan_row(
    ctx: &mut Context<AcceptSettlementPlanRow>,
    _epoch: u64,
    revision: u64,
    ordinal: u64,
    attempt: u64,
    revisions: [u64; 3],
) -> Result<()> {
    let mut remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    require!(
        accounts.plan.revision == revision && accounts.plan.order_attempt == attempt,
        ClearingError::Resolution
    );
    let header = &accounts.prepared;
    let values = binding(header, &accounts.rates, &accounts.plan)?;
    let page_plan = settlement_plan_row_pages(header, &accounts.rates, &accounts.plan, ordinal)?;
    let frozen = frozen_row(header, &accounts.page, ordinal)?;
    let mut window = window(header, &accounts.plan, page_plan, revisions, &mut remaining)?;
    let layout = exact(Layout::new(header.count))?;
    accept_row(
        header,
        &accounts.rates,
        &mut accounts.plan,
        values,
        ordinal,
        frozen,
        *accounts.actor.address(),
        Clock::get()?.slot,
        &mut GraphPages {
            layout,
            store: &mut window,
        },
    )
}
#[inline(never)]
fn accept_row(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &mut SettlementPlan,
    values: VerifiedRateValues,
    ordinal: u64,
    frozen: FrozenMargin,
    actor: Address,
    slot: u64,
    pages: &mut GraphPages<'_, impl LimbStorage>,
) -> Result<()> {
    match plan.stage {
        PLAN_FLOW_AWAIT => {
            let work = exact(FlowWork::new(
                values,
                ordinal,
                frozen.id,
                Row {
                    cash: frozen.cash,
                    claims: frozen.claims,
                },
            ))?;
            save(plan, &work.checkpoint());
            plan.stage = PLAN_FLOW_WORK;
        }
        PLAN_FLOW_STORE => {
            let work = flow(plan, values)?;
            require!(
                work.identity() == (ordinal, frozen.id),
                ClearingError::Resolution
            );
            let result = exact(work.result())?;
            exact(pages.write_flow(
                ordinal,
                FlowRecord {
                    id: frozen.id,
                    cash: frozen.cash,
                    whole: result.whole,
                    order: result.order,
                    fractional: result.fractional,
                    directions: frozen.claims.map(|claim| claim.signum() as i8),
                    seen_attempt: 0,
                    seen_mask: 0,
                    applied: false,
                },
            ))?;
            plan.cursor = plan
                .cursor
                .checked_add(1)
                .ok_or(ClearingError::Arithmetic)?;
            plan.stage = if plan.cursor == header.count {
                PLAN_ORDER_AWAIT
            } else {
                PLAN_FLOW_AWAIT
            };
            save(plan, &[]);
        }
        PLAN_ORDER_WORK => {
            require!(actor == plan.proposer, ClearingError::Resolution);
            let mut work = order(plan, values)?;
            let position = exact(work.position())?;
            let mut row = exact(pages.flow(ordinal))?;
            require!(
                row.id == frozen.id
                    && row.cash == frozen.cash
                    && !row.applied
                    && row.directions == frozen.claims.map(|claim| claim.signum() as i8),
                ClearingError::Resolution
            );
            if row.seen_attempt != plan.order_attempt {
                require!(
                    row.seen_attempt < plan.order_attempt,
                    ClearingError::Resolution
                );
                row.seen_attempt = plan.order_attempt;
                row.seen_mask = 0;
            }
            let bit = 1 << plan.order_market;
            require!(row.seen_mask & bit == 0, ClearingError::Resolution);
            exact(work.accept(
                ordinal,
                frozen.id,
                frozen.claims[usize::from(plan.order_market)],
            ))?;
            row.seen_mask |= bit;
            exact(pages.write_flow(ordinal, row))?;
            exact(pages.write_order(plan.order_market, position, ordinal))?;
            Work::Order(work).save(header, rates, plan)?;
        }
        _ => return Err(ClearingError::Resolution.into()),
    }
    plan.last_progress_slot = slot;
    Ok(())
}

pub fn begin_plan_order(
    ctx: &mut Context<ManageSettlementPlan>,
    _epoch: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    start_order(
        &accounts.prepared,
        &accounts.rates,
        &mut accounts.plan,
        revision,
        *accounts.actor.address(),
        Clock::get()?.slot,
    )
}
fn start_order(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &mut SettlementPlan,
    revision: u64,
    actor: Address,
    slot: u64,
) -> Result<()> {
    let values = binding(header, rates, plan)?;
    require!(
        plan.revision == revision && plan.stage == PLAN_ORDER_AWAIT && plan.cursor == header.count,
        ClearingError::Resolution
    );
    plan.order_attempt = plan
        .order_attempt
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    plan.order_market = 0;
    plan.proposer = actor;
    plan.last_progress_slot = slot;
    save(plan, &exact(OrderWork::new(values, 0))?.checkpoint());
    plan.stage = PLAN_ORDER_WORK;
    Ok(())
}
pub fn reset_plan_order(
    ctx: &mut Context<ManageSettlementPlan>,
    _epoch: u64,
    revision: u64,
    attempt: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    binding(&accounts.prepared, &accounts.rates, &accounts.plan)?;
    reset_order(
        &mut accounts.plan,
        revision,
        attempt,
        *accounts.actor.address(),
        Clock::get()?.slot,
    )
}
fn reset_order(
    plan: &mut SettlementPlan,
    revision: u64,
    attempt: u64,
    actor: Address,
    slot: u64,
) -> Result<()> {
    require!(
        plan.revision == revision
            && plan.order_attempt == attempt
            && [PLAN_ORDER_WORK, PLAN_ORDER_REJECTED].contains(&plan.stage)
            && (plan.stage == PLAN_ORDER_REJECTED
                || actor == plan.proposer
                || slot
                    .checked_sub(plan.last_progress_slot)
                    .ok_or(ClearingError::Resolution)?
                    >= RATE_STALL_SLOTS),
        ClearingError::Resolution
    );
    plan.stage = PLAN_ORDER_AWAIT;
    save(plan, &[]);
    Ok(())
}
pub fn continue_plan(
    ctx: &mut Context<ContinueSettlementPlan>,
    _epoch: u64,
    revision: u64,
    attempt: u64,
    steps: u16,
    revisions: [u64; 3],
) -> Result<()> {
    require!(steps > 0 && steps <= 128, ClearingError::Resolution);
    let mut remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    require!(
        accounts.plan.revision == revision && accounts.plan.order_attempt == attempt,
        ClearingError::Resolution
    );
    let header = &accounts.prepared;
    let layout = exact(Layout::new(header.count))?;
    let mut work = Work::restore(header, &accounts.rates, &accounts.plan)?;
    let page_plan = page_plan(work.accesses(layout)?, layout)?;
    let mut window = window(header, &accounts.plan, page_plan, revisions, &mut remaining)?;
    let mut progressed = 0;
    for _ in 0..steps {
        let Ok(accesses) = work.accesses(layout) else {
            break;
        };
        if !window.covers(accesses) {
            break;
        }
        work.step(layout, &mut window)?;
        progressed += 1;
    }
    require!(progressed > 0, ClearingError::Resolution);
    work.save(header, &accounts.rates, &mut accounts.plan)?;
    accounts.plan.last_progress_slot = Clock::get()?.slot;
    Ok(())
}

#[cfg(test)]
mod tests;

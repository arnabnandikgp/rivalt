use super::*;
use crate::instructions::account_safety::settlement_pages::{PageVersion, PageWindow};
use financial_core::clearing::scalable::pages::{PagePlan, PAGE_WORDS};

fn cursor(header: &PreparedSettlement) -> Result<DenominatorPass> {
    require!(header.stage == DENOMINATOR, ClearingError::Resolution);
    let capacity =
        required_limbs(header.count).map_err(|_| ProgramError::from(ClearingError::Arithmetic))?;
    DenominatorPass::from_checkpoint(&header.state.denominator, header.count, capacity)
        .map_err(|_| ClearingError::Resolution.into())
}

pub fn denominator_plan(header: &PreparedSettlement) -> Result<PagePlan> {
    let work = cursor(header)?;
    PagePlan::next(
        work.accesses()
            .map_err(|_| ProgramError::from(ClearingError::Resolution))?,
        required_limbs(header.count).map_err(|_| ProgramError::from(ClearingError::Arithmetic))?,
    )
    .map_err(|_| ClearingError::Resolution.into())
}

pub fn initialize_limb_page(
    ctx: &mut Context<InitializeSettlementLimbPage>,
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
    let capacity = required_limbs(accounts.prepared.count)
        .map_err(|_| ProgramError::from(ClearingError::Arithmetic))?;
    require!(
        ((accounts.prepared.stage <= DENOMINATOR && register <= 2)
            || (accounts.prepared.stage == PROPOSAL && (3..=24).contains(&register)))
            && page_index < capacity.div_ceil(PAGE_WORDS),
        ClearingError::Resolution
    );
    super::workspace::reset_limbs(&mut accounts.page, &accounts.source.storage, accounts.prepared.epoch)?;
    let page = &mut accounts.page;
    page.schema_version = SETTLEMENT_SCHEMA;
    page.venue = accounts.prepared.venue;
    page.epoch = accounts.prepared.epoch;
    page.attempt = 0;
    page.register = register;
    page.page_index = page_index;
    page.word_count = (capacity - page_index * PAGE_WORDS).min(PAGE_WORDS) as u16;
    Ok(())
}

pub fn accept_denominator_row(
    ctx: &mut Context<AcceptDenominatorRow>,
    _epoch: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    require!(
        accounts.prepared.revision == revision,
        ClearingError::Resolution
    );
    let mut work = cursor(&accounts.prepared)?;
    let ordinal = work
        .row_index()
        .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    require!(
        accounts.page.schema_version == SETTLEMENT_SCHEMA
            && accounts.page.page_index == ordinal / 8
            && ordinal % 8 < u64::from(accounts.page.row_count),
        ClearingError::Resolution
    );
    let frozen = &accounts.page.rows[(ordinal % 8) as usize];
    let row = Row {
        cash: frozen.cash,
        claims: frozen.claims,
    };
    work.accept(ordinal, frozen.id, &row)
        .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    accounts.prepared.state.denominator = work.checkpoint();
    if work.is_done() {
        accounts.prepared.stage = PROPOSAL;
    }
    Ok(())
}

pub fn continue_denominator(
    ctx: &mut Context<ContinueSettlementDenominator>,
    _epoch: u64,
    revision: u64,
    steps: u16,
    revisions: [u64; 3],
) -> Result<()> {
    require!(steps > 0 && steps <= 128, ClearingError::Resolution);
    let mut remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    require!(
        accounts.prepared.revision == revision,
        ClearingError::Resolution
    );
    let mut work = cursor(&accounts.prepared)?;
    let plan = denominator_plan(&accounts.prepared)?;
    let length = plan.requests().len();
    require!(
        revisions[length..].iter().all(|revision| *revision == 0),
        ClearingError::Resolution
    );
    // These revisions are optimistic replay guards, never proof of historical
    // progress. Only the owned header derives operations, epoch and attempt.
    let versions = revisions.map(|revision| PageVersion {
        attempt: 0,
        revision,
    });
    let mut window = PageWindow::load(
        &accounts.prepared.venue,
        accounts.prepared.epoch,
        plan,
        &versions[..length],
        &mut remaining,
    )?;
    for _ in 0..steps {
        let Ok(accesses) = work.accesses() else {
            break;
        };
        if !window.covers(accesses) {
            break;
        }
        work.step(&mut window)
            .map_err(|_| ProgramError::from(ClearingError::Arithmetic))?;
    }
    // The scope wrapper advances all declared write revisions exactly once.
    // Calling PageWindow::commit here would double-increment them.
    accounts.prepared.state.denominator = work.checkpoint();
    if work.is_done() {
        accounts.prepared.stage = PROPOSAL;
    }
    Ok(())
}

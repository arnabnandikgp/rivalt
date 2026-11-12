use super::*;
use crate::instructions::account_safety::settlement_pages::{PageVersion, PageWindow};
use financial_core::clearing::scalable::{
    insurance_rounds::InsuranceRounds,
    normalized::Magnitude,
    pages::{PagePlan, PAGE_WORDS},
    rate_work::{RateInput, RateWork},
};

pub const AWAIT_RATE: u8 = 0;
pub const UPLOAD_RATE: u8 = 1;
pub const VERIFY_RATE: u8 = 2;
pub const REJECTED_RATE: u8 = 3;
pub const VERIFIED_RATE: u8 = 4;
/// Liveness only: expiry never changes frozen cash, rates, or insurance. Every
/// successful upload/word/row is real bounded progress, not a heartbeat endpoint.
pub const RATE_STALL_SLOTS: u64 = 64;
pub const RATE_CHUNK_WORDS: usize = 32;

fn arithmetic<T>(value: financial_core::Result<T>) -> Result<T> {
    value.map_err(|_| ClearingError::Resolution.into())
}
fn rounds(header: &PreparedSettlement, rates: &SettlementRates) -> Result<InsuranceRounds> {
    arithmetic(InsuranceRounds::from_checkpoint(
        &rates.state.insurance,
        header.insurance,
    ))
}
#[inline(never)]
pub(super) fn input(header: &PreparedSettlement, rates: &SettlementRates) -> Result<RateInput> {
    require!(
        header.stage == PROPOSAL
            && rates.schema_version == SETTLEMENT_SCHEMA
            && rates.venue == header.venue
            && rates.epoch == header.epoch,
        ClearingError::Resolution
    );
    let capacity = arithmetic(required_limbs(header.count))?;
    let (register, used) = arithmetic(
        DenominatorPass::from_checkpoint(&header.state.denominator, header.count, capacity)
            .and_then(|work| work.result()),
    )?;
    let totals = arithmetic(
        SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
            .and_then(|scan| scan.result()),
    )?;
    Ok(RateInput {
        count: header.count,
        common: Magnitude { register, used },
        rate_lengths: rates.lengths,
        factor: rates.factor,
        positive: totals.positive,
        negative: totals.negative,
        pools: header.pools,
        budgets: rounds(header, rates)?.budgets(),
    })
}
#[inline(never)]
fn cursor(header: &PreparedSettlement, rates: &SettlementRates) -> Result<RateWork> {
    require!(rates.stage == VERIFY_RATE, ClearingError::Resolution);
    arithmetic(RateWork::from_checkpoint(
        &rates.state.work,
        input(header, rates)?,
    ))
}

/// A completed rate evaluation alone is insufficient: its original-budget
/// insurance history must also be terminal and its integral result identical.
pub(super) fn verified_rates(
    header: &PreparedSettlement,
    rates: &SettlementRates,
) -> Result<(
    financial_core::clearing::scalable::rate_work::VerifiedRateValues,
    [u64; 2],
)> {
    require!(
        rates.stage == VERIFIED_RATE && rates.attempt > 0,
        ClearingError::Resolution
    );
    let insurance = rounds(header, rates)?;
    let (spent, _) = arithmetic(insurance.result())?;
    let work = arithmetic(RateWork::from_checkpoint(
        &rates.state.work,
        input(header, rates)?,
    ))?;
    let result = arithmetic(work.result())?;
    require!(
        result.spent == spent && result.fractional == [false; 2],
        ClearingError::Resolution
    );
    Ok((arithmetic(work.verified_values())?, spent))
}
pub(crate) struct RateContinuation {
    work: RateWork,
    pages: PagePlan,
}
impl RateContinuation {
    pub(crate) fn pages(&self) -> PagePlan { self.pages }
}
#[inline(never)]
pub(crate) fn prepare_rate_continuation(header: &PreparedSettlement, rates: &SettlementRates) -> Result<Box<RateContinuation>> {
    let work = cursor(header, rates)?;
    let accesses = arithmetic(work.accesses())?;
    let capacity = arithmetic(required_limbs(header.count))?;
    let pages = arithmetic(if accesses.iter().all(Option::is_none) {
        PagePlan::metadata_only(capacity)
    } else {
        PagePlan::next(accesses, capacity)
    })?;
    Ok(Box::new(RateContinuation { work, pages }))
}
pub fn rate_plan(header: &PreparedSettlement, rates: &SettlementRates) -> Result<PagePlan> {
    Ok(prepare_rate_continuation(header, rates)?.pages())
}
pub fn initialize_rates(ctx: &mut Context<InitializeSettlementRates>, _epoch: u64) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    require!(
        accounts.prepared.stage == PROPOSAL,
        ClearingError::Resolution
    );
    super::workspace::reset_rates(&mut accounts.rates, &accounts.source.storage, accounts.prepared.epoch)?;
    let rates = &mut accounts.rates;
    rates.schema_version = SETTLEMENT_SCHEMA;
    rates.venue = accounts.prepared.venue;
    rates.epoch = accounts.prepared.epoch;
    rates.state.insurance =
        arithmetic(InsuranceRounds::new(accounts.prepared.insurance))?.checkpoint();
    Ok(())
}
pub fn begin_rate_proposal(
    ctx: &mut Context<ManageSettlementProposal>,
    _epoch: u64,
    revision: u64,
    factor: [u64; 5],
    lengths: [u64; 2],
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    let rates = &mut accounts.rates;
    require!(
        rates.revision == revision
            && [AWAIT_RATE, REJECTED_RATE].contains(&rates.stage)
            && !rounds(&accounts.prepared, rates)?.is_done(),
        ClearingError::Resolution
    );
    rates.factor = factor;
    rates.lengths = lengths;
    // Construction enforces count-derived width and factor domain. Numerator
    // normalization is established by complete sequential page upload below.
    let work = arithmetic(RateWork::new(input(&accounts.prepared, rates)?))?;
    rates.attempt = rates
        .attempt
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    rates.proposer = *accounts.actor.address();
    rates.last_progress_slot = Clock::get()?.slot;
    rates.uploaded = [0; 2];
    rates.state.work = work.checkpoint();
    rates.stage = if lengths == [0; 2] {
        VERIFY_RATE
    } else {
        UPLOAD_RATE
    };
    Ok(())
}
pub fn reset_rate_proposal(
    ctx: &mut Context<ManageSettlementProposal>,
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
    let rates = &mut accounts.rates;
    let slot = Clock::get()?.slot;
    require!(
        rates.revision == revision
            && rates.attempt == attempt
            && [UPLOAD_RATE, VERIFY_RATE, REJECTED_RATE].contains(&rates.stage)
            && (rates.stage == REJECTED_RATE
                || (rates.stage == UPLOAD_RATE && *accounts.actor.address() == rates.proposer)
                || slot
                    .checked_sub(rates.last_progress_slot)
                    .ok_or(ClearingError::Resolution)?
                    >= RATE_STALL_SLOTS),
        ClearingError::Resolution
    );
    // Freeze and successful insurance rounds survive. New attempt reuses the
    // same finite register/page addresses; no caller chooses an opcode or total.
    rates.stage = AWAIT_RATE;
    rates.state.work = [0; 960];
    Ok(())
}
pub fn upload_rate(
    ctx: &mut Context<UploadSettlementRate>,
    _epoch: u64,
    revision: u64,
    attempt: u64,
    market: u8,
    offset: u64,
    words: Vec<u64>,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    require!(
        market < 2 && !words.is_empty() && words.len() <= RATE_CHUNK_WORDS,
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    let rates = &mut accounts.rates;
    let market = usize::from(market);
    let end = offset
        .checked_add(words.len() as u64)
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        rates.stage == UPLOAD_RATE
            && rates.revision == revision
            && rates.attempt == attempt
            && *accounts.proposer.address() == rates.proposer
            && rates.uploaded[market] == offset
            && end <= rates.lengths[market]
            && (end != rates.lengths[market] || words.last() != Some(&0)),
        ClearingError::Resolution
    );
    let page = &mut accounts.page;
    let capacity = arithmetic(required_limbs(accounts.prepared.count))?;
    require!(
        page.schema_version == SETTLEMENT_SCHEMA
            && page.register == 3 + market as u32
            && page.page_index == offset / PAGE_WORDS
            && page.word_count as u64 == (capacity - page.page_index * PAGE_WORDS).min(PAGE_WORDS)
            && offset % PAGE_WORDS + words.len() as u64 <= u64::from(page.word_count)
            && (page.attempt == attempt || (page.attempt < attempt && offset % PAGE_WORDS == 0)),
        ClearingError::Resolution
    );
    let start = (offset % PAGE_WORDS) as usize;
    page.payload.words[start..start + words.len()].copy_from_slice(&words);
    page.attempt = attempt;
    rates.uploaded[market] = end;
    rates.last_progress_slot = Clock::get()?.slot;
    if rates.uploaded == rates.lengths {
        rates.stage = VERIFY_RATE;
    }
    Ok(())
}
pub fn prepare_rate_scratch(
    ctx: &mut Context<PrepareRateScratch>,
    _epoch: u64,
    attempt: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    let rates = &accounts.rates;
    let page = &mut accounts.page;
    require!(
        [UPLOAD_RATE, VERIFY_RATE].contains(&rates.stage)
            && rates.attempt == attempt
            && page.schema_version == SETTLEMENT_SCHEMA
            && (5..=24).contains(&page.register)
            && page.attempt < attempt,
        ClearingError::Resolution
    );
    // Dirty tails are deliberately retained. The normalized kernel never reads
    // an uncomputed word; reused page tags cannot erase same-attempt work.
    page.attempt = attempt;
    Ok(())
}
fn save_progress(
    header: &PreparedSettlement,
    rates: &mut SettlementRates,
    work: &RateWork,
    slot: u64,
) -> Result<()> {
    rates.state.work = work.checkpoint();
    rates.last_progress_slot = slot;
    if work.is_done() {
        let mut insurance = rounds(header, rates)?;
        arithmetic(insurance.accept(arithmetic(work.result())?))?;
        rates.state.insurance = insurance.checkpoint();
        rates.stage = if insurance.is_done() {
            VERIFIED_RATE
        } else {
            AWAIT_RATE
        };
    }
    Ok(())
}
pub fn accept_rate_row(
    ctx: &mut Context<AcceptSettlementRateRow>,
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
    require!(
        accounts.rates.revision == revision && accounts.rates.attempt == attempt,
        ClearingError::Resolution
    );
    let mut work = cursor(&accounts.prepared, &accounts.rates)?;
    let ordinal = arithmetic(work.row_index())?;
    require!(
        accounts.page.schema_version == SETTLEMENT_SCHEMA
            && accounts.page.page_index == ordinal / 8
            && ordinal % 8 < u64::from(accounts.page.row_count),
        ClearingError::Resolution
    );
    let frozen = &accounts.page.rows[(ordinal % 8) as usize];
    if work
        .accept(
            ordinal,
            frozen.id,
            Row {
                cash: frozen.cash,
                claims: frozen.claims,
            },
        )
        .is_err()
    {
        accounts.rates.stage = REJECTED_RATE;
        return Ok(());
    }
    save_progress(
        &accounts.prepared,
        &mut accounts.rates,
        &work,
        Clock::get()?.slot,
    )
}
pub(crate) fn continue_rates(
    ctx: &mut Context<ContinueSettlementRates>,
    _epoch: u64,
    revision: u64,
    attempt: u64,
    steps: u16,
    revisions: [u64; 3],
    mut continuation: Box<RateContinuation>,
) -> Result<()> {
    require!(steps > 0 && steps <= 128, ClearingError::Resolution);
    let mut remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    require!(
        accounts.rates.revision == revision && accounts.rates.attempt == attempt,
        ClearingError::Resolution
    );
    let plan = continuation.pages();
    let work = &mut continuation.work;
    let length = plan.requests().len();
    require!(
        revisions[length..].iter().all(|revision| *revision == 0),
        ClearingError::Resolution
    );
    let mut versions = [PageVersion {
        attempt,
        revision: 0,
    }; 3];
    for (index, request) in plan.requests().iter().enumerate() {
        versions[index].revision = revisions[index];
        if request.register <= 1 {
            versions[index].attempt = 0;
        }
    }
    let mut window = PageWindow::load(
        &accounts.prepared.venue,
        accounts.prepared.epoch,
        plan,
        &versions[..length],
        &mut remaining,
    )?;
    for _ in 0..steps {
        let Ok(accesses) = work.accesses() else { break };
        if !window.covers(accesses) {
            break;
        }
        if work.step(&mut window).is_err() {
            // An authenticated attempted equation failed. Persist rejection,
            // not a fabricated financial success; neither reserves nor frozen
            // input were touched. A new attempt cannot read this scratch.
            accounts.rates.stage = REJECTED_RATE;
            return Ok(());
        }
    }
    // scoped_history owns every declared write-page revision exactly once.
    save_progress(
        &accounts.prepared,
        &mut accounts.rates,
        &work,
        Clock::get()?.slot,
    )
}

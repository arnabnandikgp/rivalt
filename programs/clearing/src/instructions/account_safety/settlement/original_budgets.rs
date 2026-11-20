//! Freeze each member's original debt budget before any forced reduction.
use super::*;
use crate::instructions::account_safety::settlement_pages::{PageVersion, PageWindow};
use default_plan_selection::joint::original_terms::OriginalTerms;
use financial_core::clearing::scalable::{
    normalized::Magnitude,
    pages::{PagePlan, PageRequest, PAGE_WORDS},
    rate_work::RateWork,
    wide::LimbStorage,
};
use num_bigint::BigUint;

pub struct OriginalRegisters {
    values: [Magnitude; 7],
    pub pages: PagePlan,
}

impl OriginalRegisters {
    #[inline(never)]
    pub fn verified(header: &PreparedSettlement, rates: &SettlementRates) -> Result<Box<Self>> {
        require!(
            original_rates(header.stage) && rates.stage == VERIFIED_RATE && rates.attempt != 0,
            ClearingError::Resolution
        );
        let work =
            RateWork::from_checkpoint(&rates.state.work, super::rates::input(header, rates)?)
                .map_err(|_| ClearingError::Resolution)?;
        let result = work.result().map_err(|_| ClearingError::Resolution)?;
        let values = work
            .verified_values()
            .map_err(|_| ClearingError::Resolution)?;
        let (spent, _) = super::rates::rounds(header, rates)?
            .result()
            .map_err(|_| ClearingError::Resolution)?;
        require!(result.spent == spent, ClearingError::Resolution);
        let [btc, eth, denominator] = values.payment_registers();
        let values = [
            btc,
            eth,
            denominator,
            result.residuals[0],
            result.residuals[1],
            result.losses[0],
            result.losses[1],
        ];
        require!(
            values.iter().all(|value| value.used <= PAGE_WORDS),
            ClearingError::Resolution
        );
        let requests = values.map(|value| PageRequest {
            register: value.register,
            index: 0,
            writable: false,
        });
        let capacity = required_limbs(header.count).map_err(|_| ClearingError::Resolution)?;
        let pages = PagePlan::window(&requests, capacity).map_err(|_| ClearingError::Resolution)?;
        Ok(Box::new(Self { values, pages }))
    }

    fn terms(&self, window: &PageWindow<'_>) -> Result<OriginalTerms> {
        let read = |position: usize| -> Result<BigUint> {
            let value = self.values[position];
            let mut digits = Vec::with_capacity(2 * value.used as usize);
            for index in 0..value.used {
                let word = window
                    .read(value.register, index)
                    .map_err(|_| ClearingError::Resolution)?;
                digits.extend([word as u32, (word >> 32) as u32]);
            }
            Ok(BigUint::new(digits))
        };
        OriginalTerms::from_market_totals(
            [read(0)?, read(1)?],
            read(2)?,
            [read(5)?, read(6)?],
            [read(3)?, read(4)?],
        )
        .map_err(|_| ClearingError::Resolution.into())
    }
}

pub fn record(
    ctx: &mut Context<RecordOriginalBudgets>,
    registers: &OriginalRegisters,
    attempt: u64,
    revision: u64,
    revisions: [u64; 7],
) -> Result<()> {
    let mut remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    let header = &accounts.prepared;
    accounts.source.frozen().matches(header)?;
    let page = &mut accounts.page;
    let start = page
        .page_index
        .checked_mul(8)
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        page.schema_version == SETTLEMENT_SCHEMA
            && start < header.count
            && u64::from(page.row_count) == (header.count - start).min(8)
            && page.revision == revision
            && accounts.rates.attempt == attempt
            && page.original_budget_attempt == 0,
        ClearingError::Resolution
    );
    let versions = revisions.map(|revision| PageVersion { attempt, revision });
    let window = PageWindow::load(
        &header.venue,
        header.epoch,
        registers.pages,
        &versions,
        &mut remaining,
    )?;
    let terms = registers.terms(&window)?;
    let count = usize::from(page.row_count);
    for record in &mut page.rows[..count] {
        record.original_debtor_budgets = terms
            .debtor_budgets(&Row {
                cash: record.cash,
                claims: record.claims,
            })
            .map_err(|_| ClearingError::Resolution)?;
    }
    page.original_budget_attempt = attempt;
    Ok(())
}

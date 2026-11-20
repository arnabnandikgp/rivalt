//! Consume every authenticated budget page before sealing foreign charge bounds.
use super::{original_budgets::OriginalRegisters, *};
use crate::instructions::account_safety::settlement_pages::{PageVersion, PageWindow};
use default_plan_selection::joint::foreign_protection::ProtectionTotals;
use financial_core::clearing::scalable::{membership::Request, snapshot::ClaimTotal};

const MARKER: &[u8; 8] = b"RVBOUND1";

#[derive(AnchorSerialize, AnchorDeserialize, Default)]
struct BoundScan {
    epoch: u64,
    attempt: u64,
    members: u64,
    own_cash_upper: [[u64; 3]; 2],
    linked_face: [[u64; 3]; 2],
    incoming_debt: [[u64; 3]; 2],
    budget: [u128; 2],
    linked_caps: [u128; 2],
}

impl BoundScan {
    const BYTES: usize = 3 * 8 + 3 * 2 * 24 + 2 * 2 * 16;

    fn resume(header: &PreparedSettlement, attempt: u64) -> Result<Self> {
        let bytes = &header.state.membership;
        if bytes.starts_with(MARKER) {
            let scan: Self = crate::wire::read(&bytes[8..8 + Self::BYTES])?;
            require!(
                scan.epoch == header.epoch
                    && scan.attempt == attempt
                    && scan.members < header.count,
                ClearingError::Resolution
            );
            return Ok(scan);
        }
        let membership = MembershipCursor::from_checkpoint(bytes, header.count)
            .map_err(|_| ClearingError::Resolution)?;
        require!(
            membership.request() == Request::Done,
            ClearingError::Resolution
        );
        Ok(Self {
            epoch: header.epoch,
            attempt,
            ..Self::default()
        })
    }

    fn totals(&self) -> Result<ProtectionTotals> {
        let read = |[left, right]: [[u64; 3]; 2]| -> Result<[ClaimTotal; 2]> {
            Ok([
                ClaimTotal::from_words(left).map_err(|_| ClearingError::Resolution)?,
                ClaimTotal::from_words(right).map_err(|_| ClearingError::Resolution)?,
            ])
        };
        Ok(ProtectionTotals {
            own_cash_upper: read(self.own_cash_upper)?,
            linked_face: read(self.linked_face)?,
            incoming_debt: read(self.incoming_debt)?,
            budget: self.budget,
        })
    }
}

pub fn scan(
    ctx: &mut Context<ScanForeignProtection>,
    registers: &OriginalRegisters,
    attempt: u64,
    revision: u64,
    revisions: [u64; 7],
) -> Result<()> {
    let mut remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    let header = &mut accounts.prepared;
    accounts.source.frozen().matches(header)?;
    require!(
        header.revision == revision && accounts.rates.attempt == attempt,
        ClearingError::Resolution
    );
    let mut scan = BoundScan::resume(header, attempt)?;
    let page = &accounts.page;
    require!(
        page.schema_version == SETTLEMENT_SCHEMA
            && page.original_budget_attempt == attempt
            && page.page_index.checked_mul(8) == Some(scan.members)
            && u64::from(page.row_count) == (header.count - scan.members).min(8),
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
    let mut totals = scan.totals()?;
    for record in &page.rows[..usize::from(page.row_count)] {
        totals
            .include(
                &Row {
                    cash: record.cash,
                    claims: record.claims,
                },
                record.original_debtor_budgets,
            )
            .map_err(|_| ClearingError::Resolution)?;
    }
    scan.members += u64::from(page.row_count);
    scan.own_cash_upper = totals.own_cash_upper.map(ClaimTotal::words);
    scan.linked_face = totals.linked_face.map(ClaimTotal::words);
    scan.incoming_debt = totals.incoming_debt.map(ClaimTotal::words);
    scan.budget = totals.budget;
    if scan.members == header.count {
        let snapshot =
            SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
                .and_then(|scan| scan.result())
                .map_err(|_| ClearingError::Resolution)?;
        scan.linked_caps = totals
            .linked_caps(
                snapshot.positive,
                header.pools,
                header.insurance,
                &registers.terms(&window)?,
            )
            .map_err(|_| ClearingError::Resolution)?;
    }
    let bytes = &mut header.state.membership;
    bytes.fill(0);
    bytes[..8].copy_from_slice(MARKER);
    crate::wire::write(&scan, &mut bytes[8..8 + BoundScan::BYTES])
}

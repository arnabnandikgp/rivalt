//! Verification-only paged successor. Source authority comes from the existing
//! complete frozen epoch, not a keeper's supplied membership or valuation.
use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;
use financial_core::clearing::{
    row::Row,
    scalable::{
        cohort_denominator::DenominatorPass,
        membership::{MembershipCursor, Request},
        snapshot::{SnapshotBinding, SnapshotScan},
        wide::required_limbs,
    },
};

mod contexts;
mod denominator;
pub use denominator::*;
mod handlers;
mod source;
pub use contexts::*;
pub use handlers::*;
pub(crate) use source::*;

pub const PREPARE_INDEX: u8 = 0;
pub const VALUE: u8 = 1;
pub const DENOMINATOR: u8 = 2;
pub const PROPOSAL: u8 = 3;

pub(crate) fn snapshot_binding(header: &PreparedSettlement) -> SnapshotBinding {
    SnapshotBinding {
        count: header.count,
        allocated: header.allocated,
        pools: header.pools,
        insurance: header.insurance,
        fees: header.fees,
        gross: header.gross,
    }
}

/// Called only after the complete authenticated index has been provisioned.
pub(crate) fn begin_value(header: &mut PreparedSettlement) -> Result<()> {
    require!(
        header.stage == PREPARE_INDEX
            && header.index_initialized == 0x7fff
            && header.member_page_initialized,
        ClearingError::Resolution
    );
    let membership = MembershipCursor::new(header.count)
        .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    let valuation = SnapshotScan::new(snapshot_binding(header))
        .map_err(|_| ProgramError::from(ClearingError::Reconciliation))?;
    header.state.membership = membership.checkpoint();
    header.state.valuation = valuation.checkpoint();
    header.stage = VALUE;
    Ok(())
}

/// The caller has authenticated the frozen epoch, member page, canonical margin
/// root and row page. Commit the row and both cursor bytes in one invocation.
pub(crate) fn value_member(
    header: &mut PreparedSettlement,
    page: &mut FrozenMarginPage,
    member_key: Address,
    entry: &MemberEntry,
    root: &MarginAccount,
) -> Result<()> {
    require!(header.stage == VALUE, ClearingError::Resolution);
    let mut membership = MembershipCursor::from_checkpoint(&header.state.membership, header.count)
        .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    let Request::Member { ordinal, id } = membership.request() else {
        return Err(ClearingError::Resolution.into());
    };
    // Schema-8 has immutable, never-reused IDs and no activation/deactivation.
    // The bridge maps every registry entry to generation 1; P55 replaces this
    // source binding with the explicit schema-9 lifecycle/generation.
    require!(
        root.schema_version == SCHEMA_VERSION
            && root.venue == header.venue
            && u64::from(root.id) == id
            && entry.root == member_key
            && entry.lifecycle == MEMBER_FINANCIAL
            && entry.activation_generation == 1
            && root.revision > 0
            && page.schema_version == SETTLEMENT_SCHEMA
            && page.venue == header.venue
            && page.epoch == header.epoch
            && page.page_index == ordinal / 8
            && u64::from(page.row_count) == ordinal % 8,
        ClearingError::Resolution
    );
    let model = crate::instructions::account_trading::model(root)?;
    let claims = model
        .claims(header.prices, header.funding)
        .map_err(|_| ProgramError::from(ClearingError::Arithmetic))?;
    let row = Row {
        cash: root.cash,
        claims,
    };
    let collected = row
        .collected()
        .map_err(|_| ProgramError::from(ClearingError::Arithmetic))?;
    let lots = root.positions.map(|position| position.lots);
    let mut valuation =
        SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
            .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    valuation
        .accept(ordinal, id, &row, lots)
        .map_err(|_| ProgramError::from(ClearingError::Reconciliation))?;
    membership
        .member(id)
        .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    page.rows[usize::from(page.row_count)] = FrozenMargin {
        id,
        member: member_key,
        activation_generation: 1,
        original_revision: root.revision,
        cash: root.cash,
        lots,
        generations: root.positions.map(|position| position.generation),
        claims,
        collected,
    };
    page.row_count += 1;
    header.state.valuation = valuation.checkpoint();
    header.state.membership = membership.checkpoint();
    Ok(())
}

pub(crate) fn finish_value(header: &mut PreparedSettlement) -> Result<()> {
    require!(header.stage == VALUE, ClearingError::Resolution);
    let membership = MembershipCursor::from_checkpoint(&header.state.membership, header.count)
        .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    require!(
        membership.request() == Request::Done,
        ClearingError::Resolution
    );
    SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
        .and_then(|scan| scan.result())
        .map_err(|_| ProgramError::from(ClearingError::Reconciliation))?;
    let capacity =
        required_limbs(header.count).map_err(|_| ProgramError::from(ClearingError::Arithmetic))?;
    header.state.denominator = DenominatorPass::new(header.count, capacity)
        .map_err(|_| ProgramError::from(ClearingError::Arithmetic))?
        .checkpoint();
    header.stage = DENOMINATOR;
    Ok(())
}

#[cfg(test)]
mod tests;

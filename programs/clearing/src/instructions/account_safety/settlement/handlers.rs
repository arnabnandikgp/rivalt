use super::*;
use crate::instructions::account_safety::settlement_membership;

pub fn initialize(
    ctx: &mut Context<InitializePreparedSettlement>,
    epoch: u64,
    source_revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let source = ctx.accounts.source.frozen();
    require!(
        source.source.epoch == epoch && source.source.revision == source_revision,
        ClearingError::Resolution
    );
    super::workspace::reset_prepared(&mut ctx.accounts.prepared, source.storage, epoch)?;
    source.initialize(&mut ctx.accounts.prepared)?;
    begin_value(&mut ctx.accounts.prepared)?;
    Ok(())
}
pub fn initialize_rows(
    ctx: &mut Context<InitializeFrozenMarginPage>,
    _epoch: u64,
    page_index: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    require!(
        accounts.prepared.stage <= VALUE && page_index < accounts.prepared.count.div_ceil(8),
        ClearingError::Resolution
    );
    super::workspace::reset_rows(&mut accounts.page, &accounts.source.storage, accounts.prepared.epoch)?;
    let page = &mut accounts.page;
    page.schema_version = SETTLEMENT_SCHEMA;
    page.venue = accounts.prepared.venue;
    page.epoch = accounts.prepared.epoch;
    page.page_index = page_index;
    Ok(())
}
pub fn advance_membership(
    ctx: &mut Context<AdvancePreparedMembership>,
    _epoch: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    accounts.source.frozen().matches(&accounts.prepared)?;
    let header = &mut accounts.prepared;
    require!(
        header.revision == revision && header.stage == VALUE,
        ClearingError::Resolution
    );
    let mut cursor = MembershipCursor::from_checkpoint(&header.state.membership, header.count)
        .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    match cursor.request() {
        Request::Node { .. } => settlement_membership::advance_node(
            &mut cursor,
            &header.venue,
            accounts.index.account(),
        )?,
        Request::Page { .. } => settlement_membership::advance_page(
            &mut cursor,
            &header.venue,
            accounts.index.account(),
        )?,
        _ => return Err(ClearingError::Resolution.into()),
    }
    header.state.membership = cursor.checkpoint();
    if cursor.request() == Request::Done {
        finish_value(header)?;
    }
    Ok(())
}
pub fn value(ctx: &mut Context<ValuePreparedMember>, _epoch: u64, revision: u64) -> Result<()> {
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
    let membership = MembershipCursor::from_checkpoint(
        &accounts.prepared.state.membership,
        accounts.prepared.count,
    )
    .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    let entry = settlement_membership::financial_member(
        &membership,
        &accounts.prepared.venue,
        accounts.members.account(),
    )?;
    value_member(
        &mut accounts.prepared,
        &mut accounts.page,
        *accounts.margin.address(),
        &entry,
        &accounts.margin,
    )?;
    #[cfg(all(feature = "book-inventory-qualification", not(feature = "integrated-recovery-qualification")))]
    {
        let index=usize::from(accounts.page.row_count)-1;
        let row=&mut accounts.page.rows[index];
        #[cfg(not(feature="multi-lot-book-qualification"))]
        if row.lots[0].unsigned_abs()==1 && row.claims[0]>0 {
            row.book_capacity=crate::profit_attribution::frozen_history(&accounts.margin,0)?
                .frozen_capacity(row.lots[0],accounts.prepared.prices[0],row.claims[0],1)
                .map_err(|_|ClearingError::Resolution)?.eligible;
        }
        #[cfg(feature="multi-lot-book-qualification")]
        if row.lots[0]!=0 && row.claims[0]>0 {
            let quantity=row.lots[0].unsigned_abs();
            let terms=crate::profit_attribution::frozen_history(&accounts.margin,0)?
                .frozen_capacity(row.lots[0],accounts.prepared.prices[0],row.claims[0],quantity)
                .map_err(|_|ClearingError::Resolution)?;
            let rate=terms.lot_rate(quantity).map_err(|_|ClearingError::Resolution)?;
            row.book_capacity=terms.eligible;
            row.lot_rate=[rate.numerator,rate.denominator];
        }
    }
    Ok(())
}

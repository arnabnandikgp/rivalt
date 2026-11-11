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
    source.initialize(&mut ctx.accounts.prepared)?;
    ctx.accounts.prepared.bump = ctx.bumps.prepared;
    Ok(())
}
fn preparing(
    source: &PreparedSourceIdentity,
    header: &PreparedSettlement,
    revision: u64,
) -> Result<()> {
    source.frozen().matches(header)?;
    require!(
        header.revision == revision && header.stage == PREPARE_INDEX,
        ClearingError::Resolution
    );
    Ok(())
}
fn ready(header: &mut PreparedSettlement) -> Result<()> {
    if header.index_initialized == 0x7fff && header.member_page_initialized {
        begin_value(header)?;
    }
    Ok(())
}
pub fn initialize_node(
    ctx: &mut Context<InitializePreparedIndexNode>,
    _epoch: u64,
    level: u8,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    preparing(&accounts.source, &accounts.prepared, revision)?;
    require!(
        level < 15 && accounts.prepared.index_initialized & (1 << level) == 0,
        ClearingError::Resolution
    );
    let node = &mut accounts.node;
    node.schema_version = SETTLEMENT_SCHEMA;
    node.venue = accounts.prepared.venue;
    node.level = level;
    node.prefix = 0;
    node.populated_mask = 1;
    node.counts[0] = accounts.prepared.count;
    node.bump = ctx.bumps.node;
    accounts.prepared.index_initialized |= 1 << level;
    ready(&mut accounts.prepared)
}
pub fn initialize_members(
    ctx: &mut Context<InitializePreparedMembers>,
    _epoch: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    preparing(&accounts.source, &accounts.prepared, revision)?;
    require!(
        !accounts.prepared.member_page_initialized,
        ClearingError::Resolution
    );
    let page = &mut accounts.page;
    page.schema_version = SETTLEMENT_SCHEMA;
    page.venue = accounts.prepared.venue;
    page.page_index = 0;
    let count = accounts.prepared.count;
    page.allocated_mask = if count == 64 {
        u64::MAX
    } else {
        (1u64 << count) - 1
    };
    page.financial_mask = page.allocated_mask;
    page.bump = ctx.bumps.page;
    for (index, member) in accounts.source.registry.members.iter().enumerate() {
        page.members.entries[index] = MemberEntry {
            root: *member,
            lifecycle: MEMBER_FINANCIAL,
            activation_generation: 1,
        };
    }
    accounts.prepared.member_page_initialized = true;
    ready(&mut accounts.prepared)
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
    let page = &mut accounts.page;
    page.schema_version = SETTLEMENT_SCHEMA;
    page.venue = accounts.prepared.venue;
    page.epoch = accounts.prepared.epoch;
    page.page_index = page_index;
    page.bump = ctx.bumps.page;
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
    )
}

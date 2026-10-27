use super::*;

fn page_range(
    header: &ResolutionV3,
    page: &ResolutionPageV3,
    stage: u8,
    start: u16,
    length: u8,
) -> Result<()> {
    require!(
        header.stage == stage
            && header.cursor == start
            && (1..=2).contains(&length)
            && start
                .checked_add(u16::from(length))
                .is_some_and(|end| end <= header.count)
            && page.schema_version == SCHEMA_VERSION
            && page.page_index == start / 2
            && start % 2 + u16::from(length) <= 2,
        ClearingError::Resolution
    );
    Ok(())
}

#[inline(never)]
fn member(
    info: &AccountInfo,
    registry: &VenueRegistryV3,
    id: usize,
) -> Result<Box<MarginAccountV3>> {
    require!(
        info.owner == &crate::ID
            && !info.is_writable
            && !info.is_signer
            && registry.members.get(id) == Some(info.key)
            && info.data_len() == 8 + MarginAccountV3::INIT_SPACE,
        ClearingError::Resolution
    );
    let root = Box::new(MarginAccountV3::try_deserialize(
        &mut &info.try_borrow_data()?[..],
    )?);
    require!(
        root.venue == registry.venue && root.id as usize == id,
        ClearingError::Resolution
    );
    let expected = Pubkey::create_program_address(
        &[
            b"margin-v3",
            root.portfolio.as_ref(),
            &root.subaccount_index.to_le_bytes(),
            &[root.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| error!(ClearingError::Resolution))?;
    require_keys_eq!(*info.key, expected, ClearingError::Resolution);
    account_trading::model(&root)?;
    Ok(root)
}

/// All scalars below come from an authenticated root under frozen funding/prices.
/// No q/v or cash is written to that root during either preparation pass.
pub(super) fn value_row(
    header: &mut ResolutionV3,
    row: &mut ResolutionRowV3,
    key: Pubkey,
    root: &MarginAccountV3,
) -> Result<()> {
    let claims = checked(account_trading::model(root)?.claims(header.prices, header.funding))?;
    let model = Row {
        cash: root.cash,
        claims,
    };
    checked(model.validate())?;
    row.member = key;
    row.cash_before = root.cash;
    row.lots = root.positions.map(|position| position.lots);
    row.generations = root.positions.map(|position| position.generation);
    row.claims_scaled = claims;
    row.collected = checked(model.collected())?;
    row.rounded_flows = [0; 2];
    row.cash_after = 0;
    row.applied = false;
    for flow in &mut row.exact_flow_numerators {
        flow.limbs.fill(0);
    }
    header.scanned_cash = checked(math::cash_add(header.scanned_cash, root.cash))?;
    for index in 0..2 {
        header.scanned_lots[index] = header.scanned_lots[index]
            .checked_add(i128::from(row.lots[index]))
            .ok_or(ClearingError::Arithmetic)?;
        header.scanned_gross[index] = header.scanned_gross[index]
            .checked_add(row.lots[index].unsigned_abs())
            .ok_or(ClearingError::Arithmetic)?;
        header.claim_sums[index] = header.claim_sums[index]
            .checked_add(claims[index])
            .ok_or(ClearingError::Arithmetic)?;
        header.positive_scaled[index] = header.positive_scaled[index]
            .checked_add(claims[index].max(0) as u128)
            .ok_or(ClearingError::Arithmetic)?;
        require!(
            header.positive_scaled[index] < (1u128 << 93),
            ClearingError::Resolution
        );
    }
    Ok(())
}

pub(super) fn finish_value(header: &mut ResolutionV3) -> Result<()> {
    require!(
        header.cursor == header.count
            && header.scanned_cash == header.cash_before
            && header.scanned_lots == [0; 2]
            && header.scanned_gross == header.remaining_gross
            && header.claim_sums
                == header
                    .pools_before
                    .map(|pool| i128::from(pool) * math::SCALE),
        ClearingError::Reconciliation
    );
    header.stage = DENOMINATOR;
    header.cursor = 0;
    wide::set_u128(&mut header.common.limbs, 1);
    Ok(())
}

pub fn advance(
    ctx: Context<AdvanceAccountResolutionV3>,
    epoch: u64,
    stage: u8,
    start: u16,
    length: u8,
) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    frozen(
        &accounts.identity,
        &accounts.registry,
        &accounts.resolution,
        epoch,
    )?;
    require!(
        matches!(stage, VALUE | DENOMINATOR | VERIFY | FLOW_PLAN)
            && accounts.work.schema_version == SCHEMA_VERSION
            && accounts.work.epoch == epoch,
        ClearingError::Resolution
    );
    page_range(&accounts.resolution, &accounts.page, stage, start, length)?;
    if stage == FLOW_PLAN && start == 0 {
        rounding::initialize_plan(&accounts.resolution, &mut accounts.work)?;
    }
    require!(
        ctx.remaining_accounts.len() == if stage == VALUE { length as usize } else { 0 },
        ClearingError::Resolution
    );
    let page = &mut accounts.page;
    if stage == VALUE && start % 2 == 0 {
        require!(page.epoch < epoch, ClearingError::Resolution);
        page.epoch = epoch;
        page.row_count = 0;
    }
    require!(page.epoch == epoch, ClearingError::Resolution);
    let clock = Clock::get()?;
    for offset in 0..usize::from(length) {
        let id = usize::from(start) + offset;
        let within = id % RESOLUTION_PAGE_ROWS;
        if stage == VALUE {
            require!(
                usize::from(page.row_count) == within,
                ClearingError::Resolution
            );
            let info = &ctx.remaining_accounts[offset];
            let root = member(info, &accounts.registry, id)?;
            value_row(
                &mut accounts.resolution,
                &mut page.rows[within],
                *info.key,
                &root,
            )?;
            page.row_count += 1;
            increment(&mut accounts.identity.custody.sequence)?;
            emit_value(
                &accounts.identity,
                &accounts.resolution,
                id as u16,
                &page.rows[within],
                &clock,
                accounts.event_authority.to_account_info(),
            )?;
        } else {
            require!(
                within < page.row_count as usize
                    && !page.rows[within].applied
                    && accounts.registry.members[id] == page.rows[within].member,
                ClearingError::Resolution
            );
            let row = Row {
                cash: page.rows[within].cash_before,
                claims: page.rows[within].claims_scaled,
            };
            require!(
                checked(row.collected())? == page.rows[within].collected,
                ClearingError::Resolution
            );
            if stage == DENOMINATOR {
                checked(row.denominator(&mut accounts.resolution.common.limbs))?;
            } else if stage == VERIFY {
                rates::verify_row(
                    &accounts.resolution,
                    &mut accounts.work,
                    &mut page.rows[within],
                )?;
            } else {
                rounding::plan_row(
                    &accounts.resolution,
                    &mut accounts.work,
                    &mut page.rows[within],
                    id,
                )?;
                increment(&mut accounts.identity.custody.sequence)?;
                crate::event_cpi::emit(
                    &crate::events::AccountResolutionPlannedV3 {
                        venue: accounts.identity.venue.key(),
                        sequence: accounts.identity.custody.sequence,
                        slot: clock.slot,
                        epoch,
                        id: id as u16,
                        member: page.rows[within].member,
                        flow_floors: page.rows[within].rounded_flows,
                        cash_floor: page.rows[within].cash_after,
                    },
                    accounts.event_authority.to_account_info(),
                )?;
            }
        }
    }
    accounts.resolution.cursor += u16::from(length);
    if accounts.resolution.cursor == accounts.resolution.count {
        if stage == VALUE {
            finish_value(&mut accounts.resolution)?;
        } else if stage == DENOMINATOR {
            require!(
                wide::bits(&accounts.resolution.common.limbs) <= 5632,
                ClearingError::Resolution
            );
            accounts.resolution.stage = RATE_PROPOSAL;
            accounts.resolution.cursor = 0;
        } else if stage == VERIFY {
            let proposal_hash = accounts.resolution.proposal_hash;
            let evaluation = accounts.resolution.evaluation;
            let outcome = rates::finish(&mut accounts.resolution, &mut accounts.work);
            increment(&mut accounts.identity.custody.sequence)?;
            crate::event_cpi::emit(
                &crate::events::AccountResolutionRatesV3 {
                    venue: accounts.identity.venue.key(),
                    sequence: accounts.identity.custody.sequence,
                    slot: clock.slot,
                    epoch,
                    evaluation,
                    proposal_hash,
                    outcome,
                    next_evaluation: accounts.resolution.evaluation,
                    clipped_mask: accounts.resolution.clipped_mask,
                    budgets: accounts.resolution.budgets,
                    insurance_spent: accounts.resolution.insurance_spent,
                },
                accounts.event_authority.to_account_info(),
            )?;
        } else {
            accounts.resolution.stage = EDGE_ORDER;
            accounts.resolution.cursor = 0;
            accounts.work.limb_cursor = 0;
        }
    }
    accounts.work.opcode = accounts.resolution.stage;
    accounts.work.row = accounts.resolution.cursor;
    increment(&mut accounts.identity.custody.sequence)?;
    crate::event_cpi::emit(
        &crate::events::AccountResolutionProgressV3 {
            venue: accounts.identity.venue.key(),
            sequence: accounts.identity.custody.sequence,
            slot: clock.slot,
            epoch,
            processed_stage: stage,
            start,
            length,
            next_stage: accounts.resolution.stage,
            next_cursor: accounts.resolution.cursor,
            evaluation: accounts.resolution.evaluation,
            clipped_mask: accounts.resolution.clipped_mask,
        },
        accounts.event_authority.to_account_info(),
    )
}

fn emit_value(
    identity: &ResolutionIdentityV3,
    header: &ResolutionV3,
    id: u16,
    row: &ResolutionRowV3,
    clock: &Clock,
    authority: AccountInfo,
) -> Result<()> {
    crate::event_cpi::emit(
        &crate::events::AccountResolutionValuedV3 {
            venue: identity.venue.key(),
            sequence: identity.custody.sequence,
            slot: clock.slot,
            epoch: header.epoch,
            id,
            member: row.member,
            cash: row.cash_before,
            lots: row.lots,
            generations: row.generations,
            claims_scaled: row.claims_scaled,
            collected: row.collected,
        },
        authority,
    )
}

#[cfg(test)]
pub(super) fn test_page_range(
    header: &ResolutionV3,
    page: &ResolutionPageV3,
    stage: u8,
    start: u16,
    length: u8,
) -> Result<()> {
    page_range(header, page, stage, start, length)
}

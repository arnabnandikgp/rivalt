//! Exactly-once application of a complete conserving plan. While Frozen, custody
//! retains the original aggregate ledger plus explicit applied/remaining rows;
//! mixed live roots are never added to those frozen aggregates a second time.
use super::*;

fn empty_position(position: &crate::state::Position) -> bool {
    position.lots == 0
        && position.virtual_scaled == 0
        && position.funding_checkpoint_scaled == 0
        && position.generation == 0
}

pub(super) fn apply_row(
    header: &mut Resolution,
    work: &ResolutionWork,
    row: &mut ResolutionRow,
    root: &mut MarginAccount,
    id: usize,
) -> Result<()> {
    require!(
        !row.applied
            && header.stage == APPLY
            && id < usize::from(header.count)
            && root.cash == row.cash_before
            && root.positions.map(|position| position.lots) == row.lots
            && root.positions.map(|position| position.generation) == row.generations
            && checked(account_trading::model(root)?.claims(header.prices, header.funding))?
                == row.claims_scaled,
        ClearingError::Resolution
    );
    let count = usize::from(header.count);
    let mut final_flows = row.rounded_flows;
    for market in 0..2 {
        let increment = work.residual_capacity[2 * (market * count + id) + 1];
        require!(increment <= 1, ClearingError::Resolution);
        final_flows[market] = final_flows[market]
            .checked_add(u64::from(increment))
            .ok_or(ClearingError::Arithmetic)?;
    }
    let increment = work.residual_capacity[2 * (2 * count + id) + 1];
    require!(increment <= 1, ClearingError::Resolution);
    let final_cash = checked(math::cash_add(row.cash_after, u64::from(increment)))?;
    let mut conserved = i128::from(row.cash_before);
    for market in 0..2 {
        let movement = row.claims_scaled[market].signum() * i128::from(final_flows[market]);
        conserved = conserved
            .checked_add(movement)
            .ok_or(ClearingError::Arithmetic)?;
        header.claim_sums[market] = header.claim_sums[market]
            .checked_add(
                movement
                    .checked_mul(math::SCALE)
                    .ok_or(ClearingError::Arithmetic)?,
            )
            .ok_or(ClearingError::Arithmetic)?;
        header.remaining_lots[market] = header.remaining_lots[market]
            .checked_sub(i128::from(row.lots[market]))
            .ok_or(ClearingError::Arithmetic)?;
        header.remaining_gross[market] = header.remaining_gross[market]
            .checked_sub(row.lots[market].unsigned_abs())
            .ok_or(ClearingError::Arithmetic)?;
        header.remaining_claims[market] = header.remaining_claims[market]
            .checked_sub(row.claims_scaled[market])
            .ok_or(ClearingError::Arithmetic)?;
    }
    require!(
        conserved == i128::from(final_cash)
            && final_cash
                >= row
                    .cash_before
                    .checked_sub(row.collected)
                    .ok_or(ClearingError::Arithmetic)?,
        ClearingError::Reconciliation
    );
    header.scanned_cash = checked(math::cash_sub(header.scanned_cash, row.cash_before))?;
    header.cash_applied = checked(math::cash_add(header.cash_applied, final_cash))?;
    root.cash = final_cash;
    for (market, position) in root.positions.iter_mut().enumerate() {
        if root.mode == MODE_ISOLATED && usize::from(root.isolated_market_index) != market {
            require!(empty_position(position), ClearingError::Profile);
            continue;
        }
        position.lots = 0;
        position.virtual_scaled = 0;
        position.funding_checkpoint_scaled = header.funding[market];
        increment_counter(&mut position.generation)?;
    }
    // Keep monotonic order IDs while removing every executable order/protection.
    let last_order_id = root.book.last_order_id;
    root.book = Default::default();
    root.book.last_order_id = last_order_id;
    root.reserved = 0;
    root.delegate = Pubkey::default();
    root.delegate_expiry_slot = 0;
    increment_counter(&mut root.delegate_epoch)?;
    increment_counter(&mut root.nonce)?;
    increment_counter(&mut root.state_version)?;
    account_trading::model(root)?;
    row.rounded_flows = final_flows;
    row.cash_after = final_cash;
    row.applied = true;
    Ok(())
}

// Avoid shadowing the checked counter helper with a rounding increment.
fn increment_counter(counter: &mut u64) -> Result<()> {
    increment(counter)
}

pub(super) fn check_complete_plan(header: &Resolution) -> Result<()> {
    let mut expected_cash = u128::from(header.cash_before);
    for market in 0..2 {
        let supply =
            u128::from(header.pools_before[market]) + u128::from(header.insurance_spent[market]);
        expected_cash += supply;
        require!(
            header.claim_sums[market]
                == i128::try_from(supply).map_err(|_| error!(ClearingError::Arithmetic))?
                    * math::SCALE,
            ClearingError::Reconciliation
        );
    }
    require!(
        header.cursor == header.count
            && header.scanned_cash == 0
            && header.remaining_lots == [0; 2]
            && header.remaining_gross == [0; 2]
            && header.remaining_claims == [0; 2]
            && u128::from(header.cash_applied) == expected_cash,
        ClearingError::Reconciliation
    );
    Ok(())
}

pub(super) fn reconcile_row(
    header: &mut Resolution,
    row: &ResolutionRow,
    root: &MarginAccount,
) -> Result<()> {
    require!(
        row.applied
            && root.cash == row.cash_after
            && root.positions.iter().enumerate().all(|(market, position)| {
                if root.mode == MODE_ISOLATED && usize::from(root.isolated_market_index) != market {
                    empty_position(position)
                } else {
                    position.lots == 0
                        && position.virtual_scaled == 0
                        && position.funding_checkpoint_scaled == header.funding[market]
                        && row.generations[market].checked_add(1) == Some(position.generation)
                }
            })
            && root.reserved == 0
            && root.delegate == Pubkey::default()
            && root.delegate_expiry_slot == 0
            && root
                .book
                .orders
                .iter()
                .all(|entry| !entry.order.active() && entry.order.reserve == 0)
            && root
                .book
                .protections
                .iter()
                .all(|entry| entry.protection.remaining == 0),
        ClearingError::Reconciliation
    );
    header.scanned_cash = checked(math::cash_add(header.scanned_cash, root.cash))?;
    Ok(())
}

pub fn advance(
    ctx: &mut Context<AdvanceAccountResolution>,
    events: &mut crate::event_cpi::Payloads,
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
    pages::page_range(&accounts.resolution, &accounts.page, stage, start, length)?;
    require!(
        matches!(stage, APPLY | RECONCILE)
            && ctx.remaining_accounts.len() == usize::from(length)
            && accounts.page.epoch == epoch
            && accounts.work.epoch == epoch
            && accounts.work.schema_version == SCHEMA_VERSION
            && accounts.work.opcode == stage,
        ClearingError::Resolution
    );
    let clock = Clock::get()?;
    for offset in 0..usize::from(length) {
        let id = usize::from(start) + offset;
        let within = id % 2;
        require!(
            within < accounts.page.row_count as usize
                && accounts.page.rows[within].member == accounts.registry.members[id],
            ClearingError::Resolution
        );
        let info = &ctx.remaining_accounts[offset];
        let mut root = pages::member(info, &accounts.registry, id, stage == APPLY)?;
        if stage == APPLY {
            apply_row(
                &mut accounts.resolution,
                &accounts.work,
                &mut accounts.page.rows[within],
                &mut root,
                id,
            )?;
            root.try_serialize(&mut &mut info.try_borrow_mut_data()?[..])?;
            accounts.identity.btc.gross_lots = accounts.resolution.remaining_gross[0];
            accounts.identity.eth.gross_lots = accounts.resolution.remaining_gross[1];

            emit_applied(
                &accounts.identity,
                &accounts.resolution,
                &accounts.page.rows[within],
                &root,
                id as u16,
                &clock,
                events,
                accounts.event_authority.to_account_info(),
            )?;
        } else {
            reconcile_row(&mut accounts.resolution, &accounts.page.rows[within], &root)?;
        }
    }
    accounts.resolution.cursor += u16::from(length);
    if accounts.resolution.cursor == accounts.resolution.count {
        if stage == APPLY {
            check_complete_plan(&accounts.resolution)?;
            for (index, ledger) in [
                &mut accounts.identity.btc_ledger,
                &mut accounts.identity.eth_ledger,
            ]
            .into_iter()
            .enumerate()
            {
                ledger.settlement = 0;
                ledger.insurance = checked(math::cash_sub(
                    ledger.insurance,
                    accounts.resolution.insurance_spent[index],
                ))?;
                increment(&mut ledger.version)?;
                increment(&mut ledger.liability_version)?;
            }
            accounts.resolution.stage = RECONCILE;
            accounts.resolution.cursor = 0;
            accounts.resolution.scanned_cash = 0;
        } else {
            require!(
                accounts.resolution.scanned_cash == accounts.resolution.cash_applied,
                ClearingError::Reconciliation
            );
            accounts.resolution.stage = COMPLETE;
            accounts.identity.safety.mode = RESOLVED;
            accounts.identity.safety.paused = false;
            increment(&mut accounts.identity.safety.epoch)?;
            accounts.resolution.safety_epoch = accounts.identity.safety.epoch;
        }
        profile(&accounts.identity)?;

        emit_complete(
            &accounts.identity,
            &accounts.resolution,
            &clock,
            events,
            accounts.event_authority.to_account_info(),
        )?;
    }
    accounts.work.opcode = accounts.resolution.stage;
    accounts.work.row = accounts.resolution.cursor;

    events.emit(
        &crate::events::AccountResolutionProgress {
            venue: accounts.identity.venue.key(),

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

/// Wire-identical borrowed payload: the SBF bump allocator cannot reclaim a
/// boxed full root snapshot between the two supported Apply rows.
#[derive(AnchorSerialize)]
struct AppliedView<'a> {
    venue: Pubkey,
    slot: u64,
    epoch: u64,
    id: u16,
    member: Pubkey,
    flows: [u64; 2],
    cash_before: u64,
    cash_after: u64,
    remaining_cash: u64,
    applied_cash: u64,
    remaining_lots: [i128; 2],
    remaining_gross: [u64; 2],
    remaining_claims: [i128; 2],
    state: &'a MarginAccount,
}

#[inline(never)]
fn emit_applied(
    identity: &ResolutionIdentity,
    header: &Resolution,
    row: &ResolutionRow,
    root: &MarginAccount,
    id: u16,
    clock: &Clock,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountInfo,
) -> Result<()> {
    let event = AppliedView {
        venue: identity.venue.key(),

        slot: clock.slot,
        epoch: header.epoch,
        id,
        member: row.member,
        flows: row.rounded_flows,
        cash_before: row.cash_before,
        cash_after: row.cash_after,
        remaining_cash: header.scanned_cash,
        applied_cash: header.cash_applied,
        remaining_lots: header.remaining_lots,
        remaining_gross: header.remaining_gross,
        remaining_claims: header.remaining_claims,
        state: root,
    };
    events.emit_borrowed::<crate::events::AccountResolutionApplied, _>(&event, authority)
}

#[cfg(test)]
#[test]
fn borrowed_applied_event_matches_owned_payload() {
    let root = MarginAccount {
        schema_version: SCHEMA_VERSION,
        revision: 19,
        cash: 37,
        ..Default::default()
    };
    let view = AppliedView {
        venue: Pubkey::new_unique(),
        slot: 3,
        epoch: 7,
        id: 5,
        member: Pubkey::new_unique(),
        flows: [11, 13],
        cash_before: 43,
        cash_after: 37,
        remaining_cash: 101,
        applied_cash: 71,
        remaining_lots: [-2, 3],
        remaining_gross: [4, 5],
        remaining_claims: [-7, 8],
        state: &root,
    };
    let owned = crate::events::AccountResolutionApplied {
        venue: view.venue,
        slot: view.slot,
        epoch: view.epoch,
        id: view.id,
        member: view.member,
        flows: view.flows,
        cash_before: view.cash_before,
        cash_after: view.cash_after,
        remaining_cash: view.remaining_cash,
        applied_cash: view.applied_cash,
        remaining_lots: view.remaining_lots,
        remaining_gross: view.remaining_gross,
        remaining_claims: view.remaining_claims,
        state: crate::events::MarginAccountSnapshot::from(&root),
    };
    let mut actual = Vec::new();
    let mut expected = Vec::new();
    view.serialize(&mut actual).unwrap();
    owned.serialize(&mut expected).unwrap();
    assert_eq!(actual, expected);
}

fn emit_complete(
    identity: &ResolutionIdentity,
    header: &Resolution,
    clock: &Clock,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountInfo,
) -> Result<()> {
    events.emit(
        &crate::events::AccountResolutionCompleted {
            venue: identity.venue.key(),

            slot: clock.slot,
            epoch: header.epoch,
            stage: header.stage,
            mode: identity.safety.mode,
            safety_epoch: identity.safety.epoch,
            cash: account_custody::accounted_cash(
                &identity.custody,
                [&identity.btc_ledger, &identity.eth_ledger],
            )?,
            pools: [
                identity.btc_ledger.settlement,
                identity.eth_ledger.settlement,
            ],
            insurance: [identity.btc_ledger.insurance, identity.eth_ledger.insurance],
            fees: [identity.btc_ledger.fees, identity.eth_ledger.fees],
            insurance_spent: header.insurance_spent,
            allocated: identity.custody.allocated_vault,
            actual_vault: identity.vault.amount,
            liability_versions: [
                identity.btc_ledger.liability_version,
                identity.eth_ledger.liability_version,
            ],
            ledger_versions: [identity.btc_ledger.version, identity.eth_ledger.version],
            insurance_fee_remainders: [
                identity.btc_ledger.insurance_fee_remainder,
                identity.eth_ledger.insurance_fee_remainder,
            ],
        },
        authority,
    )
}

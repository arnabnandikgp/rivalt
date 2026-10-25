//! Exact terminal claims remain in the resolution ledger, never ordinary stored v.
use super::*;

fn sum(left: u128, right: u128) -> Result<u128> {
    left.checked_add(right)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}
fn signed_sum(left: i128, right: i128) -> Result<i128> {
    left.checked_add(right)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}
fn quotient(total: u128, weight: u128, denominator: u128) -> Result<(u128, u128)> {
    if denominator == 0 {
        require!(total == 0 && weight == 0, ClearingError::Resolution);
        return Ok((0, 0));
    }
    require!(total <= denominator, ClearingError::Resolution);
    checked(math::mul_div_rem(total, weight, denominator))
}
fn bonus(rows: &[GroupResolutionRowV2], id: usize, extra: u16) -> u128 {
    let remainder = rows[id].remainder;
    let rank = rows
        .iter()
        .enumerate()
        .filter(|(other_id, row)| {
            row.remainder > remainder || (row.remainder == remainder && *other_id < id)
        })
        .count();
    u128::from(rank < usize::from(extra))
}
fn floor_end(header: &mut GroupResolutionHeaderV2, total: u128) -> Result<()> {
    let extra = total
        .checked_sub(header.assigned)
        .ok_or(ClearingError::Resolution)?;
    require!(extra < u128::from(header.count), ClearingError::Resolution);
    header.extra = u16::try_from(extra).map_err(|_| error!(ClearingError::Arithmetic))?;
    header.assigned = 0;
    Ok(())
}
fn claim(root: &MarginAccountV2, header: &GroupResolutionHeaderV2) -> Result<i128> {
    checked(account_model(root)?.claims(header.prices, header.funding))?
        .into_iter()
        .try_fold(0, signed_sum)
}
fn original(
    root: &MarginAccountV2,
    row: &GroupResolutionRowV2,
    header: &GroupResolutionHeaderV2,
) -> Result<()> {
    require!(
        root.cash == checked(math::cash_sub(row.cash_before, row.collected))?
            && root.positions.map(|position| position.lots) == row.lots
            && root.positions.map(|position| position.generation) == row.generations
            && signed_sum(claim(root, header)?, checked(math::scaled(row.collected))?)?
                == row.claim_scaled,
        ClearingError::Resolution
    );
    Ok(())
}

#[inline(never)]
pub(crate) fn finish_pass(
    group: &mut ClearingGroupV2,
    markets: &mut [&mut GroupMarketV2; 2],
    header: &mut GroupResolutionHeaderV2,
) -> Result<()> {
    match header.stage {
        VALUE => require!(
            header.scanned_cash == header.initial_cash
                && header.scanned_lots == [0; 2]
                && header.scanned_gross == header.remaining_gross
                && header.claim_sum == checked(math::scaled(header.initial_pool))?,
            ClearingError::Reconciliation
        ),
        COLLECT => {
            require!(
                header.positive.checked_sub(header.debt)
                    == Some(checked(math::scaled(group.settlement))? as u128)
                    && header.debt <= (1u128 << 96) / 3
                    && header.positive <= (1u128 << 96) / 3,
                ClearingError::Reconciliation
            );
            header.insured_atoms =
                u64::try_from((header.debt / math::SCALE as u128).min(u128::from(group.insurance)))
                    .map_err(|_| error!(ClearingError::Arithmetic))?;
            header.plan_pool = checked(math::cash_add(group.settlement, header.insured_atoms))?;
        }
        INSURANCE_FLOORS => {
            floor_end(header, checked(math::scaled(header.insured_atoms))? as u128)?
        }
        INSURANCE_AWARDS => {
            require!(
                header.assigned == checked(math::scaled(header.insured_atoms))? as u128,
                ClearingError::Reconciliation
            );
            header.assigned = 0;
        }
        IMPAIR_FLOORS => floor_end(
            header,
            header
                .debt
                .checked_sub(checked(math::scaled(header.insured_atoms))? as u128)
                .ok_or(ClearingError::Resolution)?,
        )?,
        IMPAIR_AWARDS => {
            require!(
                header.assigned
                    == header
                        .debt
                        .checked_sub(checked(math::scaled(header.insured_atoms))? as u128)
                        .ok_or(ClearingError::Resolution)?,
                ClearingError::Reconciliation
            );
            header.assigned = 0;
        }
        PAY_FLOORS => floor_end(header, u128::from(header.plan_pool))?,
        PAY_AWARDS => {
            require!(
                header.assigned == u128::from(header.plan_pool)
                    && header.rounding_sum == 0
                    && !header.insurance_moved,
                ClearingError::Reconciliation
            );
            group.insurance = checked(math::cash_sub(group.insurance, header.insured_atoms))?;
            group.settlement = checked(math::cash_add(group.settlement, header.insured_atoms))?;
            header.insurance_moved = true;
        }
        APPLY => {
            require!(
                group.settlement == 0
                    && header.paid_applied == header.plan_pool
                    && header.remaining_lots == [0; 2]
                    && header.remaining_gross == [0; 2]
                    && markets.iter().all(|market| market.gross_lots == 0),
                ClearingError::Reconciliation
            );
            header.scanned_cash = 0;
            header.scanned_lots = [0; 2];
            header.scanned_gross = [0; 2];
            header.claim_sum = 0;
        }
        RECONCILE => require!(
            header.scanned_cash == group.total_cash
                && header.scanned_lots == [0; 2]
                && header.scanned_gross == [0; 2]
                && header.claim_sum == 0
                && group.settlement == 0,
            ClearingError::Reconciliation
        ),
        _ => return err!(ClearingError::Resolution),
    }
    header.stage = header
        .stage
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    header.cursor = 0;
    Ok(())
}

#[inline(never)]
pub(crate) fn process_row(
    group: &mut ClearingGroupV2,
    markets: &mut [&mut GroupMarketV2; 2],
    resolution: &mut GroupResolutionV2,
    id: usize,
    root: &mut MarginAccountV2,
) -> Result<()> {
    require!(
        id < resolution.rows.len() && usize::from(root.id) == id,
        ClearingError::Resolution
    );
    let header = &mut resolution.header;
    let award = if matches!(header.stage, INSURANCE_AWARDS | IMPAIR_AWARDS | PAY_AWARDS) {
        bonus(&resolution.rows, id, header.extra)
    } else {
        0
    };
    let row = &mut resolution.rows[id];
    if header.stage > VALUE && header.stage < RECONCILE {
        original(root, row, header)?;
    }
    match header.stage {
        VALUE => {
            *row = GroupResolutionRowV2 {
                cash_before: root.cash,
                lots: root.positions.map(|position| position.lots),
                generations: root.positions.map(|position| position.generation),
                claim_scaled: claim(root, header)?,
                ..Default::default()
            };
            header.scanned_cash = checked(math::cash_add(header.scanned_cash, root.cash))?;
            for index in 0..2 {
                header.scanned_lots[index] =
                    signed_sum(header.scanned_lots[index], i128::from(row.lots[index]))?;
                header.scanned_gross[index] = header.scanned_gross[index]
                    .checked_add(row.lots[index].unsigned_abs())
                    .ok_or(ClearingError::Arithmetic)?;
            }
            header.claim_sum = signed_sum(header.claim_sum, row.claim_scaled)?;
        }
        COLLECT => {
            let amount = u64::try_from(
                (row.claim_scaled.min(0).unsigned_abs() / math::SCALE as u128)
                    .min(u128::from(root.cash)),
            )
            .map_err(|_| error!(ClearingError::Arithmetic))?;
            row.collected = amount;
            row.claim_scaled = signed_sum(row.claim_scaled, checked(math::scaled(amount))?)?;
            root.cash = checked(math::cash_sub(root.cash, amount))?;
            root.state_version = next(root.state_version)?;
            group.total_cash = checked(math::cash_sub(group.total_cash, amount))?;
            group.settlement = checked(math::cash_add(group.settlement, amount))?;
            header.collected_total = checked(math::cash_add(header.collected_total, amount))?;
            header.debt = sum(header.debt, row.claim_scaled.min(0).unsigned_abs())?;
            header.positive = sum(header.positive, row.claim_scaled.max(0) as u128)?;
        }
        INSURANCE_FLOORS => {
            let (allocation, remainder) = quotient(
                checked(math::scaled(header.insured_atoms))? as u128,
                row.claim_scaled.min(0).unsigned_abs(),
                header.debt,
            )?;
            row.insured_scaled = allocation;
            row.remainder = remainder;
            header.assigned = sum(header.assigned, allocation)?;
        }
        INSURANCE_AWARDS => {
            row.insured_scaled = sum(row.insured_scaled, award)?;
            header.assigned = sum(header.assigned, row.insured_scaled)?;
        }
        IMPAIR_FLOORS => {
            let total = header
                .debt
                .checked_sub(checked(math::scaled(header.insured_atoms))? as u128)
                .ok_or(ClearingError::Resolution)?;
            let (allocation, remainder) =
                quotient(total, row.claim_scaled.max(0) as u128, header.positive)?;
            row.impaired_scaled = allocation;
            row.remainder = remainder;
            header.assigned = sum(header.assigned, allocation)?;
        }
        IMPAIR_AWARDS => {
            row.impaired_scaled = sum(row.impaired_scaled, award)?;
            header.assigned = sum(header.assigned, row.impaired_scaled)?;
        }
        PAY_FLOORS => {
            let entitlement = (row.claim_scaled.max(0) as u128)
                .checked_sub(row.impaired_scaled)
                .ok_or(ClearingError::Resolution)?;
            row.paid = u64::try_from(entitlement / math::SCALE as u128)
                .map_err(|_| error!(ClearingError::Arithmetic))?;
            row.remainder = entitlement % math::SCALE as u128;
            header.assigned = sum(header.assigned, u128::from(row.paid))?;
        }
        PAY_AWARDS => {
            row.paid = checked(math::cash_add(row.paid, award as u64))?;
            header.assigned = sum(header.assigned, u128::from(row.paid))?;
            let entitlement = (row.claim_scaled.max(0) as u128)
                .checked_sub(row.impaired_scaled)
                .ok_or(ClearingError::Resolution)?;
            row.rounding_scaled = checked(math::scaled(row.paid))?
                .checked_sub(
                    i128::try_from(entitlement).map_err(|_| error!(ClearingError::Arithmetic))?,
                )
                .ok_or(ClearingError::Arithmetic)?;
            require!(
                row.rounding_scaled.unsigned_abs() < math::SCALE as u128,
                ClearingError::Reconciliation
            );
            header.rounding_sum = signed_sum(header.rounding_sum, row.rounding_scaled)?;
        }
        APPLY => {
            root.cash = checked(math::cash_add(root.cash, row.paid))?;
            for (index, position) in root.positions.iter_mut().enumerate() {
                if position.lots != 0 {
                    position.generation = next(position.generation)?;
                }
                header.remaining_lots[index] = header.remaining_lots[index]
                    .checked_sub(i128::from(position.lots))
                    .ok_or(ClearingError::Arithmetic)?;
                header.remaining_gross[index] = header.remaining_gross[index]
                    .checked_sub(position.lots.unsigned_abs())
                    .ok_or(ClearingError::Arithmetic)?;
                markets[index].gross_lots = header.remaining_gross[index];
                position.lots = 0;
                position.virtual_scaled = 0;
                position.funding_checkpoint_scaled = if root.mode == MODE_CROSS
                    || usize::from(root.isolated_market_index) == index
                {
                    header.funding[index]
                } else {
                    0
                };
            }
            root.reserved = 0;
            for entry in &mut root.book.orders {
                if entry.order.active() {
                    entry.order.state = crate::constants::orders::INVALIDATED;
                }
                entry.order.reserve = 0;
            }
            for protection in &mut root.book.protections {
                protection.protection.remaining = 0;
            }
            root.state_version = next(root.state_version)?;
            group.total_cash = checked(math::cash_add(group.total_cash, row.paid))?;
            group.settlement = checked(math::cash_sub(group.settlement, row.paid))?;
            header.paid_applied = checked(math::cash_add(header.paid_applied, row.paid))?;
            account_model(root)?;
        }
        RECONCILE => {
            require!(
                root.cash
                    == checked(math::cash_add(
                        checked(math::cash_sub(row.cash_before, row.collected))?,
                        row.paid
                    ))?
                    && root.reserved == 0
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
            for (index, position) in root.positions.iter().enumerate() {
                require!(
                    position.lots == 0
                        && position.virtual_scaled == 0
                        && position.funding_checkpoint_scaled
                            == if root.mode == MODE_CROSS
                                || usize::from(root.isolated_market_index) == index
                            {
                                header.funding[index]
                            } else {
                                0
                            }
                        && position.generation
                            == if row.lots[index] == 0 {
                                row.generations[index]
                            } else {
                                next(row.generations[index])?
                            },
                    ClearingError::Reconciliation
                );
            }
            account_model(root)?;
            header.scanned_cash = checked(math::cash_add(header.scanned_cash, root.cash))?;
        }
        _ => return err!(ClearingError::Resolution),
    }
    Ok(())
}

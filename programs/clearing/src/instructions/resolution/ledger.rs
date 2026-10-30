//! Deterministic page transitions, proportional allocation and terminal reconciliation.
use super::*;
use crate::constants::orders;

fn original(
    participant: &Participant,
    row: &LegacyResolutionRow,
    header: &ResolutionHeader,
) -> Result<()> {
    require!(
        participant.cash == checked(math::cash_sub(row.cash_before, row.collected))?
            && participant.lots == row.lots
            && participant.generation == row.generation
            && checked(
                routes::participant_model(participant)?.unpaid(header.price, header.funding)
            )?
            .checked_add(checked(math::scaled(row.collected))?)
            .ok_or(ClearingError::Arithmetic)?
                == row.claim,
        ClearingError::Resolution
    );
    Ok(())
}

fn quotient(total: u128, weight: u128, denominator: u128) -> Result<(u128, u128)> {
    if denominator == 0 {
        require!(total == 0 && weight == 0, ClearingError::Resolution);
        return Ok((0, 0));
    }
    checked(math::mul_div_rem(total, weight, denominator))
}

fn bonus(rows: &[LegacyResolutionRow], id: usize, extra: u16) -> u128 {
    let remainder = rows[id].remainder;
    let rank = rows
        .iter()
        .enumerate()
        .filter(|(other_id, other_row)| {
            other_row.remainder > remainder || (other_row.remainder == remainder && *other_id < id)
        })
        .count();
    u128::from(rank < usize::from(extra))
}

fn sum(left: u128, right: u128) -> Result<u128> {
    left.checked_add(right)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}

fn signed_sum(left: i128, right: i128) -> Result<i128> {
    left.checked_add(right)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}

fn floor_end(header: &mut ResolutionHeader, total: u128) -> Result<()> {
    let extra = total
        .checked_sub(header.assigned)
        .ok_or(ClearingError::Resolution)?;
    require!(extra < u128::from(header.count), ClearingError::Resolution);
    header.extra = u16::try_from(extra).map_err(|_| error!(ClearingError::Arithmetic))?;
    header.assigned = 0;
    Ok(())
}

#[inline(never)]
pub(super) fn finish_pass(
    market: &mut MarketState,
    route_state: &mut TestRouteState,
    header: &mut ResolutionHeader,
) -> Result<()> {
    match header.stage {
        VALUE => {
            require!(
                header.scanned_cash == header.initial_cash
                    && header.scanned_lots == 0
                    && header.scanned_gross == header.remaining_gross
                    && header.claim_sum == checked(math::scaled(header.initial_pool))?,
                ClearingError::Reconciliation
            );
        }
        COLLECT => {
            require!(
                header.positive.checked_sub(header.debt)
                    == Some(checked(math::scaled(market.settlement))? as u128),
                ClearingError::Reconciliation
            );
            header.insured_atoms = u64::try_from(
                (header.debt / math::SCALE as u128).min(u128::from(market.insurance)),
            )
            .map_err(|_| error!(ClearingError::Arithmetic))?;
            header.plan_pool = checked(math::cash_add(market.settlement, header.insured_atoms))?;
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
            market.insurance = checked(math::cash_sub(market.insurance, header.insured_atoms))?;
            market.settlement = checked(math::cash_add(market.settlement, header.insured_atoms))?;
            header.insurance_moved = true;
        }
        APPLY => {
            require!(
                market.settlement == 0
                    && header.paid_applied == header.plan_pool
                    && header.remaining_lots == 0
                    && header.remaining_gross == 0
                    && route_state.gross_lots == 0,
                ClearingError::Reconciliation
            );
            header.scanned_cash = 0;
            header.scanned_lots = 0;
            header.scanned_gross = 0;
            header.claim_sum = 0;
        }
        RECONCILE => {
            require!(
                header.scanned_cash == market.total_cash
                    && header.scanned_lots == 0
                    && header.scanned_gross == 0
                    && header.claim_sum == 0
                    && market.settlement == 0,
                ClearingError::Reconciliation
            );
        }
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
pub(super) fn process_row(
    market: &mut MarketState,
    route_state: &mut TestRouteState,
    resolution: &mut ResolutionState,
    id: usize,
    participant: &mut Participant,
) -> Result<()> {
    let header = &mut resolution.header;
    let award = if matches!(header.stage, INSURANCE_AWARDS | IMPAIR_AWARDS | PAY_AWARDS) {
        bonus(&resolution.rows, id, header.extra)
    } else {
        0
    };
    let row = &mut resolution.rows[id];
    if header.stage > VALUE && header.stage < RECONCILE {
        original(participant, row, header)?;
    }
    match header.stage {
        VALUE => {
            let model = routes::participant_model(participant)?;
            *row = LegacyResolutionRow {
                cash_before: participant.cash,
                lots: participant.lots,
                generation: participant.generation,
                claim: checked(model.unpaid(header.price, header.funding))?,
                ..LegacyResolutionRow::default()
            };
            header.scanned_cash = checked(math::cash_add(header.scanned_cash, participant.cash))?;
            header.scanned_lots = signed_sum(header.scanned_lots, i128::from(participant.lots))?;
            header.scanned_gross = header
                .scanned_gross
                .checked_add(participant.lots.unsigned_abs())
                .ok_or(ClearingError::Arithmetic)?;
            header.claim_sum = signed_sum(header.claim_sum, row.claim)?;
        }
        COLLECT => {
            let amount = u64::try_from(
                (row.claim.min(0).unsigned_abs() / math::SCALE as u128)
                    .min(u128::from(participant.cash)),
            )
            .map_err(|_| error!(ClearingError::Arithmetic))?;
            row.collected = amount;
            row.claim = signed_sum(row.claim, checked(math::scaled(amount))?)?;
            participant.cash = checked(math::cash_sub(participant.cash, amount))?;
            market.total_cash = checked(math::cash_sub(market.total_cash, amount))?;
            market.settlement = checked(math::cash_add(market.settlement, amount))?;
            header.collected_total = checked(math::cash_add(header.collected_total, amount))?;
            header.debt = sum(header.debt, row.claim.min(0).unsigned_abs())?;
            header.positive = sum(header.positive, row.claim.max(0) as u128)?;
        }
        INSURANCE_FLOORS => {
            let (allocation, remainder) = quotient(
                checked(math::scaled(header.insured_atoms))? as u128,
                row.claim.min(0).unsigned_abs(),
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
                quotient(total, row.claim.max(0) as u128, header.positive)?;
            row.impaired_scaled = allocation;
            row.remainder = remainder;
            header.assigned = sum(header.assigned, allocation)?;
        }
        IMPAIR_AWARDS => {
            row.impaired_scaled = sum(row.impaired_scaled, award)?;
            header.assigned = sum(header.assigned, row.impaired_scaled)?;
        }
        PAY_FLOORS => {
            let entitlement = (row.claim.max(0) as u128)
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
            let entitlement = (row.claim.max(0) as u128)
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
            participant.cash = checked(math::cash_add(participant.cash, row.paid))?;
            if participant.lots != 0 {
                participant.generation = next(participant.generation)?;
            }
            header.remaining_lots = header
                .remaining_lots
                .checked_sub(i128::from(participant.lots))
                .ok_or(ClearingError::Arithmetic)?;
            header.remaining_gross = header
                .remaining_gross
                .checked_sub(participant.lots.unsigned_abs())
                .ok_or(ClearingError::Arithmetic)?;
            route_state.gross_lots = header.remaining_gross;
            participant.lots = 0;
            participant.virtual_scaled = 0;
            participant.funding_checkpoint_scaled = header.funding;
            participant.reserved = 0;
            participant.order_ids = [0; 4];
            for order in &mut participant.book.orders {
                if order.active() {
                    order.state = orders::INVALIDATED;
                }
                order.reserve = 0;
            }
            for group in &mut participant.book.groups {
                group.remaining = 0;
            }
            market.total_cash = checked(math::cash_add(market.total_cash, row.paid))?;
            market.settlement = checked(math::cash_sub(market.settlement, row.paid))?;
            header.paid_applied = checked(math::cash_add(header.paid_applied, row.paid))?;
        }
        RECONCILE => {
            require!(
                participant.cash
                    == checked(math::cash_add(
                        checked(math::cash_sub(row.cash_before, row.collected))?,
                        row.paid
                    ))?
                    && participant.lots == 0
                    && participant.virtual_scaled == 0
                    && participant.funding_checkpoint_scaled == header.funding
                    && participant.reserved == 0
                    && participant.order_ids == [0; 4]
                    && participant.book.orders.iter().all(|order| !order.active())
                    && participant
                        .book
                        .groups
                        .iter()
                        .all(|group| group.remaining == 0)
                    && participant.generation
                        == if row.lots == 0 {
                            row.generation
                        } else {
                            next(row.generation)?
                        },
                ClearingError::Reconciliation
            );
            routes::participant_model(participant)?;
            header.scanned_cash = checked(math::cash_add(header.scanned_cash, participant.cash))?;
        }
        _ => return err!(ClearingError::Resolution),
    }
    Ok(())
}

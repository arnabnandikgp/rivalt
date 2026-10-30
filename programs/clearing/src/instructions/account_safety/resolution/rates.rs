//! A proposal is only a bounded encoding. Every payout equation and insurance
//! budget is recomputed from the complete frozen pages before FlowPlan.
use super::*;
use core::cmp::Ordering;

const PROPOSAL_BYTES: usize = 2 * WIDE_LIMBS * 8 + 24;
const CHUNK_BYTES: usize = 512;

// Verify register contract: [0,1] incoming flows, [2] two u128 right slopes,
// [3] L*factor, [4..8] scratch. The header owns D and both proposed numerators.
fn slopes(work: &ResolutionWork) -> [u128; 2] {
    core::array::from_fn(|index| {
        u128::from(work.registers[2].limbs[2 * index])
            | (u128::from(work.registers[2].limbs[2 * index + 1]) << 64)
    })
}
fn add_slope(work: &mut ResolutionWork, index: usize, value: u128) -> Result<()> {
    let total = slopes(work)[index]
        .checked_add(value)
        .ok_or(ClearingError::Arithmetic)?;
    require!(total < 1u128 << 93, ClearingError::Resolution);
    work.registers[2].limbs[2 * index] = total as u64;
    work.registers[2].limbs[2 * index + 1] = (total >> 64) as u64;
    Ok(())
}

fn reset(header: &mut Resolution, work: &mut ResolutionWork) {
    header.stage = RATE_PROPOSAL;
    header.cursor = 0;
    header.proposal_uploaded = 0;
    header.proposal_hash = [0; 32];
    header.insurance_spent = [0; 2];
    work.opcode = RATE_PROPOSAL;
    work.row = 0;
    work.limb_cursor = 0;
    for register in &mut work.registers {
        register.limbs.fill(0);
    }
}

/// Upload aligned little-endian limbs; restarting offset zero is allowed only
/// before verification. Hash and evaluation bind every later chunk.
pub(super) fn chunk(
    header: &mut Resolution,
    work: &mut ResolutionWork,
    evaluation: u8,
    expected_hash: [u8; 32],
    offset: u16,
    bytes: &[u8],
) -> Result<u8> {
    let start = usize::from(offset);
    require!(
        header.stage == RATE_PROPOSAL
            && header.evaluation == evaluation
            && expected_hash != [0; 32]
            && !bytes.is_empty()
            && bytes.len() <= CHUNK_BYTES
            && start % 8 == 0
            && bytes.len() % 8 == 0
            && start
                .checked_add(bytes.len())
                .is_some_and(|end| end <= PROPOSAL_BYTES),
        ClearingError::Resolution
    );
    if start == 0 {
        reset(header, work);
        header.proposal_hash = expected_hash;
    }
    require!(
        header.proposal_hash == expected_hash && usize::from(header.proposal_uploaded) == start,
        ClearingError::Resolution
    );
    for (index, bytes) in bytes.chunks_exact(8).enumerate() {
        let limb = u64::from_le_bytes(
            bytes
                .try_into()
                .map_err(|_| error!(ClearingError::Resolution))?,
        );
        let position = start / 8 + index;
        if position < 2 * WIDE_LIMBS {
            header.rate_numerators[position / WIDE_LIMBS].limbs[position % WIDE_LIMBS] = limb;
        } else {
            header.rate_factor[position - 2 * WIDE_LIMBS] = limb;
        }
    }
    header.proposal_uploaded += bytes.len() as u16;
    if usize::from(header.proposal_uploaded) != PROPOSAL_BYTES {
        return Ok(0);
    }
    // Complete wrong proposals reset deterministically. Returning an instruction
    // error here would roll back the reset and strand the final verification page.
    if prepare(header, work).is_err() {
        reset(header, work);
        return Ok(1);
    }
    header.stage = VERIFY;
    header.cursor = 0;
    work.opcode = VERIFY;
    Ok(0)
}

pub(super) fn prepare(header: &mut Resolution, work: &mut ResolutionWork) -> Result<()> {
    require!(
        header.rate_factor != [0; 3] && header.rate_factor[2] >> 58 == 0,
        ClearingError::Resolution
    );
    let mut bytes = Vec::with_capacity(PROPOSAL_BYTES);
    for rate in &header.rate_numerators {
        for limb in rate.limbs.iter() {
            bytes.extend_from_slice(&limb.to_le_bytes());
        }
    }
    for limb in header.rate_factor {
        bytes.extend_from_slice(&limb.to_le_bytes());
    }
    require!(
        solana_sha256_hasher::hash(&bytes).to_bytes() == header.proposal_hash,
        ClearingError::Resolution
    );
    require!(
        wide::bits(&header.common.limbs) > 0 && wide::bits(&header.common.limbs) <= 5632,
        ClearingError::Resolution
    );
    checked(wide::multiply(
        &mut work.registers[3].limbs,
        &header.common.limbs,
        &header.rate_factor,
    ))?;
    for rate in &header.rate_numerators {
        require!(
            wide::compare(&rate.limbs, &work.registers[3].limbs) != Ordering::Greater,
            ClearingError::Resolution
        );
    }
    checked(wide::multiply(
        &mut header.flow_denominator.limbs,
        &work.registers[3].limbs,
        &[math::SCALE as u64],
    ))?;
    Ok(())
}

pub(super) fn verify_row(
    header: &Resolution,
    work: &mut ResolutionWork,
    row: &mut ResolutionRow,
) -> Result<()> {
    let model = Row {
        cash: row.cash_before,
        claims: row.claims_scaled,
    };
    for index in 0..2 {
        let (aggregates, scratch) = work.registers.split_at_mut(4);
        let (first, second) = scratch.split_at_mut(1);
        checked(model.flow(
            index,
            &header.common.limbs,
            &header.rate_factor,
            [
                &header.rate_numerators[0].limbs,
                &header.rate_numerators[1].limbs,
            ],
            &aggregates[3].limbs,
            &mut row.exact_flow_numerators[index].limbs,
            &mut first[0].limbs,
        ))?;
        if model.claims[index] < 0 {
            checked(wide::add_assign(
                &mut aggregates[index].limbs,
                &row.exact_flow_numerators[index].limbs,
            ))?;
        }
        let slope = checked(model.right_slope(
            index,
            &header.rate_numerators[1 - index].limbs,
            &aggregates[3].limbs,
            &mut first[0].limbs,
            &mut second[0].limbs,
        ))?;
        add_slope(work, index, slope)?;
    }
    Ok(())
}

fn verify_complete(header: &Resolution, work: &mut ResolutionWork) -> Result<[(u64, bool); 2]> {
    require!(
        header.cursor == header.count && header.evaluation < 3,
        ClearingError::Resolution
    );
    checked(math::clearing::row::greatest(
        [
            &header.rate_numerators[0].limbs,
            &header.rate_numerators[1].limbs,
        ],
        &work.registers[3].limbs,
        slopes(work),
        header.positive_scaled,
    ))?;
    let mut result = [(0, false); 2];
    for index in 0..2 {
        let (aggregates, scratch) = work.registers.split_at_mut(4);
        let [outgoing, capacity, remainder, _] = scratch else {
            return err!(ClearingError::Resolution);
        };
        result[index] = checked(math::clearing::row::verify_market(
            header.positive_scaled[index],
            header.pools_before[index],
            header.budgets[index],
            &header.rate_numerators[index].limbs,
            &aggregates[3].limbs,
            &header.flow_denominator.limbs,
            &aggregates[index].limbs,
            &mut outgoing.limbs,
            &mut capacity.limbs,
            &mut remainder.limbs,
        ))?;
        if result[index].1 {
            require!(
                header.clipped_mask & (1 << index) == 0 && header.evaluation < 2,
                ClearingError::Resolution
            );
        }
    }
    Ok(result)
}

/// Result: 1 rejected/reset, 2 prescribed insurance clipping, 3 verified plan.
pub(super) fn finish(header: &mut Resolution, work: &mut ResolutionWork) -> u8 {
    let Ok(uses) = verify_complete(header, work) else {
        reset(header, work);
        return 1;
    };
    if uses.iter().any(|(_, fractional)| *fractional) {
        for (index, (spent, fractional)) in uses.into_iter().enumerate() {
            if fractional {
                header.budgets[index] = spent;
                header.clipped_mask |= 1 << index;
            }
        }
        header.evaluation += 1;
        reset(header, work);
        2
    } else {
        header.insurance_spent = uses.map(|(spent, _)| spent);
        header.stage = FLOW_PLAN;
        header.cursor = 0;
        work.opcode = FLOW_PLAN;
        work.row = 0;
        3
    }
}

/// Final equations/insurance floors are separate from even the last row. A
/// maximum-width debtor must not consume the same transaction's final budget.
pub fn finalize(
    ctx: &mut Context<ProposeAccountResolution>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    frozen(
        &accounts.identity,
        &accounts.registry,
        &accounts.resolution,
        epoch,
    )?;
    require!(
        accounts.resolution.stage == VERIFY
            && accounts.resolution.cursor == accounts.resolution.count
            && accounts.work.schema_version == SCHEMA_VERSION
            && accounts.work.epoch == epoch
            && accounts.work.opcode == VERIFY
            && accounts.work.row == accounts.resolution.count,
        ClearingError::Resolution
    );
    let proposal_hash = accounts.resolution.proposal_hash;
    let evaluation = accounts.resolution.evaluation;
    let outcome = finish(&mut accounts.resolution, &mut accounts.work);

    events.emit(
        &crate::events::AccountResolutionRates {
            venue: accounts.identity.venue.key(),

            slot: Clock::get()?.slot,
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
    )
}

pub fn upload(
    ctx: &mut Context<ProposeAccountResolution>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
    evaluation: u8,
    proposal_hash: [u8; 32],
    offset: u16,
    bytes: Vec<u8>,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    frozen(
        &accounts.identity,
        &accounts.registry,
        &accounts.resolution,
        epoch,
    )?;
    require!(
        accounts.work.schema_version == SCHEMA_VERSION && accounts.work.epoch == epoch,
        ClearingError::Resolution
    );
    let result = chunk(
        &mut accounts.resolution,
        &mut accounts.work,
        evaluation,
        proposal_hash,
        offset,
        &bytes,
    )?;

    events.emit(
        &crate::events::AccountResolutionProposal {
            venue: accounts.identity.venue.key(),

            slot: Clock::get()?.slot,
            epoch,
            evaluation,
            proposal_hash,
            offset,
            bytes,
            rejected: result == 1,
            next_stage: accounts.resolution.stage,
        },
        accounts.event_authority.to_account_info(),
    )
}

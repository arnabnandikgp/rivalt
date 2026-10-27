//! Exact whole-flow floors, verified remainder order and deterministic bounded DFS.
use super::*;
use core::cmp::Ordering;
use math::clearing::{atoms, circulation::Graph};

// After verified rates: register0 = four sign masks, required/sent at limbs4/5;
// register1 = root outgoing permutations; register2 = signed residual balances;
// register3 = previous market remainder during EdgeOrder; 4..7 = row scratch.
fn balance(work: &mut ResolutionWorkV3, node: usize, delta: i128) -> Result<()> {
    let value = i128::from(work.registers[2].limbs[node] as i64)
        .checked_add(delta)
        .ok_or(ClearingError::Arithmetic)?;
    work.registers[2].limbs[node] =
        i64::try_from(value).map_err(|_| error!(ClearingError::Arithmetic))? as u64;
    Ok(())
}

pub(super) fn initialize_plan(header: &ResolutionV3, work: &mut ResolutionWorkV3) -> Result<()> {
    require!(
        header.stage == FLOW_PLAN && header.cursor == 0,
        ClearingError::Resolution
    );
    for register in &mut work.registers {
        register.limbs.fill(0);
    }
    work.residual_capacity.fill(0);
    work.limb_cursor = 0;
    let count = usize::from(header.count);
    let mut final_cash = u128::from(header.cash_before);
    for market in 0..2 {
        let supply =
            u128::from(header.pools_before[market]) + u128::from(header.insurance_spent[market]);
        final_cash += supply;
        balance(work, count + market, supply as i128)?;
    }
    require!(
        final_cash <= u128::from(math::MAX_CASH),
        ClearingError::Reconciliation
    );
    balance(work, count + 2, -(final_cash as i128))
}

pub(super) fn plan_row(
    header: &ResolutionV3,
    work: &mut ResolutionWorkV3,
    row: &mut ResolutionRowV3,
    id: usize,
) -> Result<()> {
    let [_, _, _, _, first, second, cash, remainder] = &mut work.registers;
    let model = Row {
        cash: row.cash_before,
        claims: row.claims_scaled,
    };
    let plan = checked(atoms::plan(
        &model,
        [
            &row.exact_flow_numerators[0].limbs,
            &row.exact_flow_numerators[1].limbs,
        ],
        &header.flow_denominator.limbs,
        [
            &mut first.limbs,
            &mut second.limbs,
            &mut cash.limbs,
            &mut remainder.limbs,
        ],
    ))?;
    let count = usize::from(header.count);
    row.rounded_flows = plan.flows;
    row.cash_after = plan.cash;
    work.registers[1].limbs[id] = plan.root_order;
    work.registers[2].limbs[id] = plan.residual as u64;
    for market in 0..2 {
        if row.claims_scaled[market] != 0 {
            let sign_index = 2 * market + usize::from(row.claims_scaled[market] < 0);
            work.registers[0].limbs[sign_index] |= 1u64 << id;
        }
        let edge = market * count + id;
        work.residual_capacity[2 * edge] = u16::from(plan.fractional[market]);
        balance(
            work,
            count + market,
            -row.claims_scaled[market].signum() * i128::from(plan.flows[market]),
        )?;
    }
    work.residual_capacity[2 * (2 * count + id)] = u16::from(plan.fractional[2]);
    balance(work, count + 2, i128::from(plan.cash))
}

fn graph(work: &mut ResolutionWorkV3, count: usize) -> Graph<'_> {
    let [metadata, orders, balances, ..] = &mut work.registers;
    let signs = [
        metadata.limbs[0],
        metadata.limbs[1],
        metadata.limbs[2],
        metadata.limbs[3],
    ];
    Graph {
        count,
        signs,
        root_orders: &orders.limbs,
        balances: &balances.limbs,
        market_orders: &work.market_edge_order,
        capacities: &mut work.residual_capacity,
        parents: &mut work.parents,
        next: &mut work.dfs_next,
        path: &mut work.dfs_path,
        depth: &mut work.depth,
        augmentations: &mut work.augmentations,
        sent: &mut metadata.limbs[5],
    }
}

pub fn order(
    ctx: Context<ProposeAccountResolutionV3>,
    epoch: u64,
    orders: [Vec<u16>; 2],
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    frozen(
        &accounts.identity,
        &accounts.registry,
        &accounts.resolution,
        epoch,
    )?;
    let header = &mut accounts.resolution;
    let work = &mut accounts.work;
    require!(
        header.stage == EDGE_ORDER
            && header.cursor == 0
            && work.schema_version == SCHEMA_VERSION
            && work.epoch == epoch,
        ClearingError::Resolution
    );
    for market in 0..2 {
        require!(
            orders[market].len() == usize::from(header.count),
            ClearingError::Resolution
        );
        let mut seen = 0u64;
        for (position, id) in orders[market].iter().copied().enumerate() {
            require!(
                id < header.count && seen & (1u64 << id) == 0,
                ClearingError::Resolution
            );
            seen |= 1u64 << id;
            work.market_edge_order[market][position] = id;
        }
    }
    // Replacement is permitted before the first check only. Once checking starts,
    // everyone can continue it; a deterministic wrong-order reset unlocks retry.
    header.cursor = 0;
    work.limb_cursor = 1;
    work.registers[3].limbs.fill(0);
    increment(&mut accounts.identity.custody.sequence)?;
    crate::event_cpi::emit(
        &crate::events::AccountResolutionOrderV3 {
            venue: accounts.identity.venue.key(),
            sequence: accounts.identity.custody.sequence,
            slot: Clock::get()?.slot,
            epoch,
            orders,
        },
        accounts.event_authority.to_account_info(),
    )
}

pub fn check_order(ctx: Context<AdvanceAccountResolutionV3>, epoch: u64, start: u16) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    frozen(
        &accounts.identity,
        &accounts.registry,
        &accounts.resolution,
        epoch,
    )?;
    let header = &mut accounts.resolution;
    let work = &mut accounts.work;
    require!(
        header.stage == EDGE_ORDER
            && header.cursor == start
            && start < 2 * header.count
            && work.schema_version == SCHEMA_VERSION
            && work.epoch == epoch
            && work.limb_cursor == 1,
        ClearingError::Resolution
    );
    let market = usize::from(start / header.count);
    let position = usize::from(start % header.count);
    let id = usize::from(work.market_edge_order[market][position]);
    let page = &accounts.page;
    require!(
        page.schema_version == SCHEMA_VERSION
            && page.epoch == epoch
            && usize::from(page.page_index) == id / 2
            && usize::from(page.row_count) > id % 2
            && page.rows[id % 2].member == accounts.registry.members[id],
        ClearingError::Resolution
    );
    let row = &page.rows[id % 2];
    let previous_id = if position > 0 {
        usize::from(work.market_edge_order[market][position - 1])
    } else {
        0
    };
    let [_, _, _, previous, current, product, ..] = &mut work.registers;
    if row.claims_scaled[market] > 0 {
        current
            .limbs
            .copy_from_slice(&row.exact_flow_numerators[market].limbs[..]);
        checked(wide::multiply(
            &mut product.limbs,
            &header.flow_denominator.limbs,
            &[row.rounded_flows[market]],
        ))?;
        checked(wide::subtract_assign(&mut current.limbs, &product.limbs))?;
    } else {
        current.limbs.fill(0);
    }
    require!(
        wide::compare(&current.limbs, &header.flow_denominator.limbs) == Ordering::Less,
        ClearingError::Resolution
    );
    let valid = if position > 0 {
        let comparison = wide::compare(&previous.limbs, &current.limbs);
        comparison == Ordering::Greater || (comparison == Ordering::Equal && previous_id < id)
    } else {
        true
    };
    previous.limbs.copy_from_slice(&current.limbs[..]);
    if valid {
        header.cursor += 1;
    } else {
        // The supplied page itself is authenticated above. A wrong committed
        // ordering resets deterministically; malformed caller accounts still err.
        header.cursor = 0;
        work.limb_cursor = 0;
    }
    if header.cursor == 2 * header.count {
        checked(graph(work, usize::from(header.count)).initialize())?;
        let required = checked(graph(work, usize::from(header.count)).required())?;
        work.registers[0].limbs[4] = required;
        header.stage = ROUND;
        header.cursor = 0;
        work.opcode = ROUND;
    }
    increment(&mut accounts.identity.custody.sequence)?;
    crate::event_cpi::emit(
        &crate::events::AccountResolutionProgressV3 {
            venue: accounts.identity.venue.key(),
            sequence: accounts.identity.custody.sequence,
            slot: Clock::get()?.slot,
            epoch,
            processed_stage: EDGE_ORDER,
            start,
            length: 1,
            next_stage: header.stage,
            next_cursor: header.cursor,
            evaluation: header.evaluation,
            clipped_mask: header.clipped_mask,
        },
        accounts.event_authority.to_account_info(),
    )
}

pub fn round(ctx: Context<ProposeAccountResolutionV3>, epoch: u64, start: u16) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    frozen(
        &accounts.identity,
        &accounts.registry,
        &accounts.resolution,
        epoch,
    )?;
    let header = &mut accounts.resolution;
    let work = &mut accounts.work;
    require!(
        header.stage == ROUND
            && header.cursor == start
            && work.schema_version == SCHEMA_VERSION
            && work.epoch == epoch
            && work.opcode == ROUND,
        ClearingError::Resolution
    );
    let complete = checked(graph(work, usize::from(header.count)).step(128))?;
    header.cursor = header
        .cursor
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    if complete {
        header.stage = APPLY;
        header.cursor = 0;
        header.scanned_cash = header.cash_before;
        header.cash_applied = 0;
        header.claim_sums = [0; 2];
        work.opcode = APPLY;
    }
    increment(&mut accounts.identity.custody.sequence)?;
    crate::event_cpi::emit(
        &crate::events::AccountResolutionRoundedV3 {
            venue: accounts.identity.venue.key(),
            sequence: accounts.identity.custody.sequence,
            slot: Clock::get()?.slot,
            epoch,
            start,
            complete,
            required: work.registers[0].limbs[4],
            sent: work.registers[0].limbs[5],
            augmentations: work.augmentations,
            depth: work.depth,
        },
        accounts.event_authority.to_account_info(),
    )
}

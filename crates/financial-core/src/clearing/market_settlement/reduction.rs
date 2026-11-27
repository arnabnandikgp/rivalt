//! Forced reductions in a selected market at a supplied complete freeze.
//! The caller supplies selected-market positions and valuation from the same episode.
use super::*;
use clearing_accounting::{
    attribution::{FrozenCapacity, PairedLots},
    entry_cost::EntryCost,
    MAX_PRICE,
};
pub mod competition;
mod joint;
pub use joint::{compare_plan, MarketLegs, PlanComparison};

pub struct MarketPosition {
    pub member: u64,
    pub lots: i64,
    pub entry: EntryCost,
}

pub struct FrozenPositions<'a> {
    pub market: u16,
    pub mark: u64,
    pub positions: &'a [MarketPosition],
}

#[derive(Clone, Copy)]
pub struct Proposal {
    pub debtor: u64,
    pub winner: u64,
    pub charge: u64,
}

pub struct Comparison {
    pub schedule: PairedLots,
    pub debtor_lots_after: i64,
    pub winner_lots_after: i64,
    /// Decline in target-market creditor impairment, limited to the assigned charge.
    pub recovery: Amount,
    pub settlement: Plan,
}

fn ordered_positions<'a>(
    members: &[Prepared],
    exposure: &FrozenPositions<'a>,
) -> Result<Vec<&'a MarketPosition>> {
    if !(1..=MAX_PRICE).contains(&exposure.mark) {
        return Err(Error::Bounds);
    }
    let mut positions: Vec<_> = exposure.positions.iter().collect();
    positions.sort_unstable_by_key(|p| p.member);
    if !positions
        .iter()
        .map(|p| p.member)
        .eq(members.iter().map(|r| r.id))
    {
        return Err(Error::Cohort);
    }
    let mut net_lots = 0i128;
    for position in &positions {
        position.entry.frozen_basis(position.lots)?;
        net_lots += i128::from(position.lots);
    }
    if net_lots != 0 {
        return Err(Error::Cohort);
    }
    Ok(positions)
}

fn capacity(
    position: &MarketPosition,
    mark: u64,
    gain: &Amount,
    opposite_lots: u64,
) -> Result<FrozenCapacity> {
    let scaled = (gain * integer(SCALE))
        .to_integer()
        .to_i128()
        .ok_or(Error::Overflow)?;
    position.entry.frozen_basis(position.lots)?.frozen_capacity(
        position.lots,
        mark,
        scaled,
        opposite_lots.min(position.lots.unsigned_abs()),
    )
}

pub fn compare(
    markets: FrozenMarkets,
    roster: &[u64],
    rows: &[FrozenRow],
    vault: u64,
    exposure: FrozenPositions<'_>,
    proposal: Proposal,
) -> Result<Comparison> {
    let joint = compare_plan(
        markets,
        roster,
        rows,
        vault,
        &[MarketLegs {
            exposure,
            charges: &[proposal],
        }],
    )?;
    let (schedule, debtor_lots_after, winner_lots_after) =
        joint.fills.into_iter().next().ok_or(Error::Invariant)?;
    Ok(Comparison {
        schedule,
        debtor_lots_after,
        winner_lots_after,
        recovery: joint.recovery[joint.targets[0]].clone(),
        settlement: joint.settlement,
    })
}

fn market_loss(rows: &[RowResult], market: usize) -> Amount {
    rows.iter().map(|row| &row.impairment[market]).sum()
}

pub(super) fn protect(
    rows: &[Prepared],
    results: &mut [RowResult],
    markets: &[Market],
    spent: &[u64],
    baseline: &Plan,
    targets: &[usize],
) -> Result<()> {
    let mut minimums = vec![vec![0; markets.len()]; rows.len()];
    let mut repair = false;
    for market in
        (0..markets.len()).filter(|&market| targets.iter().any(|&charged| charged != market))
    {
        if spent[market] > baseline.spent[market]
            || market_loss(results, market) > market_loss(&baseline.rows, market)
        {
            return Err(Error::Entitlement);
        }
        for (index, (before, after)) in baseline.rows.iter().zip(results.iter()).enumerate() {
            // Only the verified direct concession on this creditor's own claim may
            // reduce its prior receipt when another market is also taking action.
            let before_claim = &before.recovered[market] + &before.impairment[market];
            let direct = before_claim - &rows[index].claims[market];
            let charged = whole(&direct)?;
            if &after.recovered[market] + direct < before.recovered[market] {
                return Err(Error::Entitlement);
            }
            let minimum = (before.movements[market] - i128::from(charged)).max(0);
            minimums[index][market] = minimum;
            repair |= minimum > 0 && after.movements[market] < minimum;
        }
    }
    if repair {
        // Preserve ordinary deterministic rounding if it already protects everyone.
        rounding::finalize(rows, results, markets, spent, Some(&minimums))?;
    }
    Ok(())
}

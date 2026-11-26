//! Feasibility of one nominated forced close at a supplied three-market freeze.
//! The caller supplies selected-market positions and valuation from the same episode.
use super::*;
use clearing_accounting::{attribution::PairedLots, entry_cost::EntryCost, MAX_PRICE};
use std::collections::BTreeMap;

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

pub fn compare(
    markets: [Market; 3],
    roster: &[u64],
    rows: &[FrozenRow],
    vault: u64,
    exposure: FrozenPositions<'_>,
    proposal: Proposal,
) -> Result<Comparison> {
    let (markets, mut members) = prepare(markets, roster, rows, vault)?;
    let target = markets
        .iter()
        .position(|market| market.id == exposure.market)
        .ok_or(Error::Cohort)?;
    if !(1..=MAX_PRICE).contains(&exposure.mark) || proposal.charge == 0 {
        return Err(Error::Bounds);
    }
    let mut positions = BTreeMap::new();
    let mut net_lots = 0i128;
    for position in exposure.positions {
        let member = members
            .binary_search_by_key(&position.member, |row| row.id)
            .map_err(|_| Error::Cohort)?;
        if positions
            .insert(position.member, (member, position))
            .is_some()
        {
            return Err(Error::Cohort);
        }
        position.entry.frozen_basis(position.lots)?;
        net_lots += i128::from(position.lots);
    }
    if positions.len() != members.len() || net_lots != 0 {
        return Err(Error::Cohort);
    }
    let &(debtor, losing) = positions.get(&proposal.debtor).ok_or(Error::Cohort)?;
    let &(winner, winning) = positions.get(&proposal.winner).ok_or(Error::Cohort)?;
    if losing.lots == 0 || winning.lots == 0 || losing.lots.signum() == winning.lots.signum() {
        return Err(Error::Entitlement);
    }

    let baseline = settle_prepared(&markets, &members, vault, None)?;
    let charge = integer(proposal.charge);
    if charge > baseline.rows[debtor].writeoff[target] || charge > members[winner].claims[target] {
        return Err(Error::Entitlement);
    }
    let face_scaled = (&members[winner].claims[target] * integer(SCALE))
        .to_integer()
        .to_i128()
        .ok_or(Error::Overflow)?;
    let available = losing.lots.unsigned_abs().min(winning.lots.unsigned_abs());
    let terms = winning.entry.frozen_basis(winning.lots)?.frozen_capacity(
        winning.lots,
        exposure.mark,
        face_scaled,
        available,
    )?;
    let schedule = terms.schedule(proposal.charge)?;
    // Closing opposite lots at the same concession transfers precisely the charge
    // at the frozen mark. Custody, fees and original cash shares are unchanged.
    members[winner].claims[target] -= &charge;
    members[debtor].remaining[target] -= &charge;
    let settlement = settle_prepared(&markets, &members, vault, Some((&baseline, target)))?;
    let recovery =
        charge.min(market_loss(&baseline.rows, target) - market_loss(&settlement.rows, target));
    let matched = i64::try_from(schedule.matched).map_err(|_| Error::Overflow)?;
    Ok(Comparison {
        schedule,
        debtor_lots_after: losing.lots - losing.lots.signum() * matched,
        winner_lots_after: winning.lots - winning.lots.signum() * matched,
        recovery,
        settlement,
    })
}

fn market_loss(rows: &[RowResult], market: usize) -> Amount {
    rows.iter().map(|row| &row.impairment[market]).sum()
}

pub(super) fn protect(
    rows: &[Prepared],
    results: &mut [RowResult],
    markets: &[Market; 3],
    spent: [u64; 3],
    baseline: &Plan,
    target: usize,
) -> Result<()> {
    let mut minimums = vec![[0; 3]; rows.len()];
    let mut repair = false;
    for market in (0..3).filter(|&market| market != target) {
        if spent[market] > baseline.spent[market]
            || market_loss(results, market) > market_loss(&baseline.rows, market)
        {
            return Err(Error::Entitlement);
        }
        for (index, (before, after)) in baseline.rows.iter().zip(results.iter()).enumerate() {
            if after.recovered[market] < before.recovered[market] {
                return Err(Error::Entitlement);
            }
            let minimum = before.movements[market].max(0);
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

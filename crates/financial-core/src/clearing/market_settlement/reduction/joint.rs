//! Value all nominated reductions against the same original book. No transfer
//! or payout can be authorized by this native comparison.
use super::*;
use std::collections::BTreeSet;

pub struct MarketLegs<'a> {
    pub exposure: FrozenPositions<'a>,
    pub charges: &'a [Proposal],
}

pub struct PlanComparison {
    pub settlement: Plan,
    pub recovery: Amounts,
    pub(super) targets: Vec<usize>,
    /// In proposal order: the schedule and the two positions immediately after this fill.
    pub fills: Vec<(PairedLots, i64, i64)>,
}

pub fn compare_plan(
    markets: FrozenMarkets,
    roster: &[u64],
    rows: &[FrozenRow],
    vault: u64,
    legs: &[MarketLegs<'_>],
) -> Result<PlanComparison> {
    let (markets, original) = prepare(markets, roster, rows, vault)?;
    let baseline = settle_prepared(&markets, &original, vault, None)?;
    let mut adjusted = original.clone();
    let mut totals = zeros(markets.len());
    let mut targets = Vec::new();
    let mut fills = Vec::new();
    for leg in legs {
        let target = markets
            .binary_search_by_key(&leg.exposure.market, |m| m.id)
            .map_err(|_| Error::Cohort)?;
        if targets.contains(&target) || leg.charges.is_empty() {
            return Err(Error::Cohort);
        }
        targets.push(target);
        let positions = ordered_positions(&original, &leg.exposure)?;
        let mut lots: Vec<_> = positions.iter().map(|p| p.lots).collect();
        let mut budgets: Amounts = baseline
            .rows
            .iter()
            .map(|r| r.writeoff[target].clone())
            .collect();
        let mut seen = BTreeSet::new();
        for proposal in leg.charges {
            if proposal.charge == 0 {
                return Err(Error::Bounds);
            }
            if !seen.insert((proposal.debtor, proposal.winner)) {
                return Err(Error::Cohort);
            }
            let index = |id| {
                original
                    .binary_search_by_key(&id, |row| row.id)
                    .map_err(|_| Error::Cohort)
            };
            let debtor = index(proposal.debtor)?;
            let winner = index(proposal.winner)?;
            let side = lots[winner].signum();
            let charge = integer(proposal.charge);
            if side == 0
                || lots[debtor].signum() != -side
                || charge > budgets[debtor]
                || charge > adjusted[winner].claims[target]
            {
                return Err(Error::Entitlement);
            }
            let room = lots[winner].unsigned_abs().min(lots[debtor].unsigned_abs());
            let terms = capacity(
                positions[winner],
                leg.exposure.mark,
                &original[winner].claims[target],
                room,
            )?;
            let schedule = terms.schedule(proposal.charge)?;
            let signed = i64::try_from(schedule.matched).map_err(|_| Error::Overflow)? * side;
            lots[debtor] += signed;
            lots[winner] -= signed;
            budgets[debtor] -= &charge;
            adjusted[debtor].remaining[target] -= &charge;
            adjusted[winner].claims[target] -= &charge;
            totals[target] += charge;
            fills.push((schedule, lots[debtor], lots[winner]));
        }
    }
    if targets.is_empty() {
        return Ok(PlanComparison {
            settlement: baseline,
            recovery: totals,
            targets,
            fills,
        });
    }
    let settlement = settle_prepared(&markets, &adjusted, vault, Some((&baseline, &targets)))?;
    let mut recovery = zeros(markets.len());
    for &target in &targets {
        recovery[target] = totals[target]
            .clone()
            .min(market_loss(&baseline.rows, target) - market_loss(&settlement.rows, target));
    }
    Ok(PlanComparison {
        settlement,
        recovery,
        targets,
        fills,
    })
}

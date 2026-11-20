//! Construct a multi-lot plan only when all four optimality bounds meet.
extern crate alloc;
use crate::{member_priority, proportional::compare_unit_cost};
use alloc::{vec, vec::Vec};
use clearing_accounting::{attribution::LotRate, Error, Result, MAX_LOTS};
use core::cmp::Ordering;

#[derive(Clone, Copy)]
pub struct Debtor {
    pub id: u64,
    pub lots: i64,
    pub budget: u64,
}
#[derive(Clone, Copy)]
pub struct Winner {
    pub id: u64,
    pub lots: i64,
    pub face: u64,
    pub rate: LotRate,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pair {
    pub debtor: u64,
    pub winner: u64,
    pub charge: u64,
    pub matched: u64,
}
pub struct Plan {
    /// In stable member order. Includes zero capacities for active nondebtors.
    pub capacities: Vec<[u64; 2]>,
    /// Positive assignments in frozen D121 winner-then-debtor priority.
    pub pairs: Vec<Pair>,
    pub total: u64,
}

fn quantity(lots: i64) -> Result<u64> {
    let value = lots.unsigned_abs();
    if value > MAX_LOTS as u64 {
        return Err(Error::Bounds);
    }
    Ok(value)
}

fn pair_capacity(debtor: Debtor, winner: Winner) -> Result<u64> {
    if debtor.budget == 0 || debtor.lots.signum() == winner.lots.signum() {
        return Ok(0);
    }
    Ok(winner.face.min(
        winner
            .rate
            .capacity(quantity(debtor.lots)?.min(quantity(winner.lots)?))?,
    ))
}

fn unique_shares(capacities: &[[u64; 2]], total: u64, gains: u64) -> Result<Option<Vec<u64>>> {
    if gains == 0 {
        return Ok(Some(vec![0; capacities.len()]));
    }
    // Start at marginal cost 2*total/gains. Rounding each exact real allocation
    // to its nearest integer selects a contiguous prefix of marginal units.
    let mut assigned = 0u128;
    let mut shares = Vec::with_capacity(capacities.len());
    for &[_, cap] in capacities {
        let product = u128::from(total) * u128::from(cap);
        let divisor = u128::from(gains);
        let share =
            u64::try_from(product / divisor + u128::from(2 * (product % divisor) > divisor))
                .map_err(|_| Error::Overflow)?;
        assigned += u128::from(share);
        shares.push(share);
    }
    // The initial total is at most half the number of winners away. Every
    // correction takes the next cheapest atom or removes the most expensive.
    while assigned != u128::from(total) {
        let add = assigned < u128::from(total);
        let mut best = None;
        for (index, (&share, &[_, cap])) in shares.iter().zip(capacities).enumerate() {
            if (add && share == cap) || (!add && share == 0) {
                continue;
            }
            let unit = share + u64::from(add);
            if best.is_none_or(|(_, other, den)| {
                let cmp = compare_unit_cost(unit, cap, other, den);
                if add {
                    cmp.is_lt()
                } else {
                    cmp.is_gt()
                }
            }) {
                best = Some((index, unit, cap));
            }
        }
        let (index, _, _) = best.ok_or(Error::Invariant)?;
        if add {
            shares[index] += 1;
            assigned += 1;
        } else {
            shares[index] -= 1;
            assigned -= 1;
        }
    }
    let mut last = None;
    let mut first = None;
    for (&share, &[_, cap]) in shares.iter().zip(capacities) {
        if share > 0
            && last.is_none_or(|(unit, den)| compare_unit_cost(share, cap, unit, den).is_gt())
        {
            last = Some((share, cap));
        }
        if share < cap
            && first.is_none_or(|(unit, den)| compare_unit_cost(share + 1, cap, unit, den).is_lt())
        {
            first = Some((share + 1, cap));
        }
    }
    if let (Some((used, cap)), Some((next, other))) = (last, first) {
        if compare_unit_cost(used, cap, next, other) != Ordering::Less {
            return Ok(None);
        }
    }
    Ok(Some(shares))
}

pub fn select(
    venue: &[u8; 32],
    epoch: u64,
    debtors: &[Debtor],
    winners: &[Winner],
) -> Result<Option<Plan>> {
    if !debtors.windows(2).all(|pair| pair[0].id < pair[1].id)
        || !winners.windows(2).all(|pair| pair[0].id < pair[1].id)
        || debtors.iter().any(|debtor| {
            winners
                .binary_search_by_key(&debtor.id, |winner| winner.id)
                .is_ok()
        })
    {
        return Err(Error::Cohort);
    }
    let mut budgets = Vec::new();
    let mut total_budget = 0u64;
    for debtor in debtors {
        if quantity(debtor.lots)? > 0 && debtor.budget != 0 {
            budgets.push(*debtor);
            total_budget = total_budget
                .checked_add(debtor.budget)
                .ok_or(Error::Overflow)?;
        }
    }
    let mut gains = 0u64;
    let mut capacities = Vec::with_capacity(winners.len());
    for &winner in winners {
        winner.rate.validate()?;
        let quantity = quantity(winner.lots)?;
        let mut available = 0u64;
        for &debtor in &budgets {
            if pair_capacity(debtor, winner)? > 0 {
                available = (available + debtor.lots.unsigned_abs().min(quantity)).min(quantity);
            }
        }
        let cap = winner.face.min(winner.rate.capacity(available)?);
        gains = gains.checked_add(cap).ok_or(Error::Overflow)?;
        capacities.push([winner.id, cap]);
    }
    let total = total_budget.min(gains);
    let Some(shares) = unique_shares(&capacities, total, gains)? else {
        return Ok(None);
    };
    let mut targets = Vec::new();
    let mut lot_floor = 0u64;
    for (&share, winner) in shares.iter().zip(winners) {
        if share > 0 {
            targets.push(share);
            lot_floor = lot_floor
                .checked_add(winner.rate.matched(share)?)
                .ok_or(Error::Overflow)?;
        }
    }
    let mut amounts: Vec<_> = budgets.iter().map(|debtor| debtor.budget).collect();
    amounts.sort_unstable_by(|a, b| b.cmp(a));
    let mut remaining = total;
    let mut needed = 0;
    for &amount in &amounts {
        if remaining == 0 {
            break;
        }
        remaining = remaining.saturating_sub(amount);
        needed += 1;
    }
    lot_floor = lot_floor.max(needed);
    // With one lot per charged debtor and winner, budgets must be a permutation
    // of the winner charges. Otherwise at least one additional lot must close.
    if total == total_budget && targets.len() == amounts.len() && targets.len() as u64 == lot_floor
    {
        targets.sort_unstable_by(|a, b| b.cmp(a));
        if targets != amounts {
            lot_floor += 1;
        }
    }
    budgets.sort_by_cached_key(|debtor| (member_priority(venue, epoch, debtor.id), debtor.id));
    let mut order: Vec<_> = (0..winners.len())
        .filter(|&index| shares[index] > 0)
        .collect();
    order.sort_by_cached_key(|&index| {
        (
            member_priority(venue, epoch, winners[index].id),
            winners[index].id,
        )
    });
    let mut used = vec![0u64; budgets.len()];
    let mut pairs = Vec::new();
    let mut lots = 0u64;
    for index in order {
        let winner = winners[index];
        let mut wanted = shares[index];
        let mut winner_used = 0u64;
        for (offset, debtor) in budgets.iter_mut().enumerate() {
            if wanted == 0 {
                break;
            }
            let charge = pair_capacity(*debtor, winner)?
                .min(debtor.budget)
                .min(wanted);
            if charge == 0 {
                continue;
            }
            let matched = winner.rate.matched(charge)?;
            used[offset] = used[offset].checked_add(matched).ok_or(Error::Overflow)?;
            winner_used = winner_used.checked_add(matched).ok_or(Error::Overflow)?;
            if used[offset] > debtor.lots.unsigned_abs() || winner_used > winner.lots.unsigned_abs()
            {
                return Ok(None);
            }
            lots = lots.checked_add(matched).ok_or(Error::Overflow)?;
            debtor.budget -= charge;
            wanted -= charge;
            pairs.push(Pair {
                debtor: debtor.id,
                winner: winner.id,
                charge,
                matched,
            });
        }
        if wanted != 0 {
            return Ok(None);
        }
    }
    if lots != lot_floor {
        return Ok(None);
    }
    Ok(Some(Plan {
        capacities,
        pairs,
        total,
    }))
}

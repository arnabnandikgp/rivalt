//! Last D121 comparison for fixed debtor totals, winner totals and lot counts.
use super::{Charge, FrozenBook, Receipt, Witness};
use crate::{
    member_priority,
    pair_prefix::{LotBudget, Position},
};
use super::alloc::{collections::BTreeMap, vec, vec::Vec};
use financial_core::{Error, Result};

impl FrozenBook<'_> {
    /// Admission and pair optimality are checked on the same receipt. Earlier
    /// priorities must separately establish these winner totals and lot counts.
    pub fn verify_with_pair_order(
        &self,
        original: Witness<'_>,
        effective: Witness<'_>,
        charges: &[Charge],
        venue: &[u8; 32],
        epoch: u64,
    ) -> Result<(Receipt, bool)> {
        let receipt = self.verify_proposal(original, effective, charges)?;
        let mut order: Vec<_> = (0..self.members.len()).collect();
        order.sort_by_cached_key(|&index| {
            let id = self.members[index].id;
            (member_priority(venue, epoch, id), id)
        });
        let bound = self.open_lot_bound(&receipt)?;
        let mut certified = bound.reached;
        for market in 0..2 {
            if certified {
                certified = self.verify_market_pairs(market, &order, charges, &receipt, &bound.budgets)?;
            }
        }
        Ok((receipt, certified))
    }

    fn verify_market_pairs(
        &self,
        market: usize,
        order: &[usize],
        charges: &[Charge],
        receipt: &Receipt,
        budgets: &[[u64; 2]],
    ) -> Result<bool> {
        let mut pairs = BTreeMap::new();
        let mut gains = vec![0u64; self.members.len()];
        let mut budget = LotBudget::default();
        for (charge, fill) in charges
            .iter()
            .zip(&receipt.fills)
            .filter(|(c, _)| c.market == market)
        {
            let winner = self
                .members
                .binary_search_by_key(&charge.winner, |m| m.id)
                .map_err(|_| Error::Cohort)?;
            gains[winner] = gains[winner]
                .checked_add(charge.atoms)
                .ok_or(Error::Overflow)?;
            budget.remaining += u128::from(fill.matched);
            pairs.insert((charge.winner, charge.debtor), fill);
        }
        if pairs.is_empty() {
            return Ok(true);
        }
        let mut winners = Vec::new();
        let mut fastest = 0;
        for &index in order {
            if gains[index] == 0 {
                continue;
            }
            let member = &self.members[index];
            let lots = member.lots[market].unsigned_abs();
            let rate = self.capacity(member, market, lots)?.lot_rate(lots)?;
            let winner = Position {
                atoms: gains[index],
                lots,
                rate: rate.numerator.div_ceil(rate.denominator),
            };
            fastest = fastest.max(winner.rate);
            budget.winner_floor += u128::from(winner.minimum_lots().ok_or(Error::Bounds)?);
            winners.push((index, winner));
        }
        let mut debtors = Vec::new();
        for &index in order {
            let atoms = budgets[index][market];
            if atoms == 0 {
                continue;
            }
            let debtor = Position {
                atoms,
                lots: self.members[index].lots[market].unsigned_abs(),
                rate: fastest,
            };
            budget.debtor_floor += u128::from(debtor.minimum_lots().ok_or(Error::Bounds)?);
            debtors.push((index, debtor));
        }
        for (winner_index, mut winner) in winners {
            let member = &self.members[winner_index];
            for (debtor_index, debtor) in &mut debtors {
                if winner.atoms == 0 {
                    break;
                }
                if debtor.atoms == 0
                    || self.members[*debtor_index].lots[market].signum()
                        != -member.lots[market].signum()
                {
                    continue;
                }
                let fill = pairs.remove(&(member.id, self.members[*debtor_index].id));
                let charge = fill.map_or(0, |fill| fill.charge);
                if budget.upper_charge(*debtor, winner) != Some(charge) {
                    return Ok(false);
                }
                if let Some(fill) = fill {
                    consume(debtor, &mut budget.debtor_floor, charge, fill.matched)?;
                    consume(&mut winner, &mut budget.winner_floor, charge, fill.matched)?;
                    budget.remaining = budget
                        .remaining
                        .checked_sub(u128::from(fill.matched))
                        .ok_or(Error::Invariant)?;
                }
            }
            if winner.atoms != 0 {
                return Ok(false);
            }
        }
        Ok(pairs.is_empty() && budget.remaining == 0 && debtors.iter().all(|(_, d)| d.atoms == 0))
    }
}

fn consume(position: &mut Position, floor: &mut u128, charge: u64, matched: u64) -> Result<()> {
    let prior = position.minimum_lots().ok_or(Error::Bounds)?;
    position.atoms = position
        .atoms
        .checked_sub(charge)
        .ok_or(Error::Entitlement)?;
    position.lots = position
        .lots
        .checked_sub(matched)
        .ok_or(Error::Entitlement)?;
    *floor = floor
        .checked_sub(u128::from(
            prior - position.minimum_lots().ok_or(Error::Bounds)?,
        ))
        .ok_or(Error::Invariant)?;
    Ok(())
}

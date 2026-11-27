//! Frozen single-market competition. Discover both winners from the whole book and
//! apply their concessions together against the debtor's original lot and cash budgets.
use super::*;

pub struct Contest {
    markets: Vec<Market>,
    target: usize,
    members: Vec<Prepared>,
    vault: u64,
    baseline: Plan,
    debtor: usize,
    debtor_lots: u64,
    budget: u64,
    winners: [usize; 2],
    terms: [FrozenCapacity; 2],
}

pub struct Allocation {
    pub charges: [u64; 2],
    pub schedules: [PairedLots; 2],
    pub recovery: Amount,
    pub settlement: Plan,
}

impl Contest {
    pub fn freeze(
        markets: FrozenMarkets,
        roster: &[u64],
        rows: &[FrozenRow],
        vault: u64,
        exposure: FrozenPositions<'_>,
    ) -> Result<Self> {
        let (markets, members) = prepare(markets, roster, rows, vault)?;
        let target = markets
            .iter()
            .position(|m| m.id == exposure.market)
            .ok_or(Error::Cohort)?;
        let positions = ordered_positions(&members, &exposure)?;
        let baseline = settle_prepared(&markets, &members, vault, None)?;
        let mut debtors = positions
            .iter()
            .enumerate()
            .filter(|(i, p)| p.lots != 0 && baseline.rows[*i].writeoff[target] >= Amount::one());
        let (debtor, position) = debtors.next().ok_or(Error::Cohort)?;
        if debtors.next().is_some() {
            return Err(Error::Cohort);
        }
        let debtor_lots = position.lots.unsigned_abs();
        let budget = whole(&baseline.rows[debtor].writeoff[target].floor())?;
        let mut edges = Vec::new();
        for (i, candidate) in positions.iter().enumerate() {
            if candidate.lots.signum() != -position.lots.signum()
                || members[i].claims[target].is_zero()
            {
                continue;
            }
            let terms = capacity(
                candidate,
                exposure.mark,
                &members[i].claims[target],
                debtor_lots,
            )?;
            if terms.eligible > 0 {
                edges.push((i, terms));
            }
        }
        let [(first, left), (second, right)] = edges.try_into().map_err(|_| Error::Cohort)?;
        Ok(Self {
            markets,
            target,
            members,
            vault,
            baseline,
            debtor,
            debtor_lots,
            budget,
            winners: [first, second],
            terms: [left, right],
        })
    }

    pub fn debtor_id(&self) -> u64 {
        self.members[self.debtor].id
    }
    pub fn winner_ids(&self) -> [u64; 2] {
        self.winners.map(|i| self.members[i].id)
    }
    pub fn weights(&self) -> [u64; 2] {
        self.terms.each_ref().map(|term| term.eligible)
    }
    pub fn budget(&self) -> u64 {
        self.budget
    }

    pub fn assess(&self, charges: [u64; 2]) -> Result<Allocation> {
        let total = charges[0].checked_add(charges[1]).ok_or(Error::Overflow)?;
        if total > self.budget || (0..2).any(|i| charges[i] > self.terms[i].eligible) {
            return Err(Error::Entitlement);
        }
        let schedules = [
            self.terms[0].schedule(charges[0])?,
            self.terms[1].schedule(charges[1])?,
        ];
        if schedules[0].matched + schedules[1].matched > self.debtor_lots {
            return Err(Error::Entitlement);
        }
        let mut members = self.members.clone();
        for (winner, charge) in self.winners.into_iter().zip(charges) {
            members[winner].claims[self.target] -= integer(charge);
        }
        members[self.debtor].remaining[self.target] -= integer(total);
        let settlement = settle_prepared(
            &self.markets,
            &members,
            self.vault,
            Some((&self.baseline, &[self.target])),
        )?;
        let recovery = integer(total).min(
            market_loss(&self.baseline.rows, self.target)
                - market_loss(&settlement.rows, self.target),
        );
        Ok(Allocation {
            charges,
            schedules,
            recovery,
            settlement,
        })
    }
}

//! Exact native search over a single frozen market. A caller must authenticate
//! the complete cohort and the absence of foreign claims and settlement pools.
extern crate alloc;
#[path = "multi_lot_bounds.rs"]
mod bounds;
use crate::member_priority;
use alloc::{vec, vec::Vec};
use clearing_accounting::{
    attribution::{Attribution, FrozenCapacity, PairedLots},
    Error, Result, MAX_CASH, MAX_PRICE, MAX_SCALED, SCALE,
};
use core::{cmp::Ordering, num::NonZeroU32};
use num_bigint::BigUint;
use num_integer::Integer;
use num_traits::{One, ToPrimitive, Zero};
use solana_sha256_hasher::Hasher;

/// The attribution bytes are the clearing-owned closed-first checkpoint at the freeze.
pub struct Member<'a> {
    pub id: u64,
    pub lots: i64,
    pub face_scaled: i128,
    pub cash: u64,
    pub history: &'a [u8],
}

struct Debtor {
    id: u64,
    lots: i64,
    budget: u64,
}

struct Winner {
    id: u64,
    lots: i64,
    terms: FrozenCapacity,
    weight: BigUint,
}

struct Edge {
    debtor: usize,
    winner: usize,
    maximum: u64,
}

pub struct Book {
    venue: [u8; 32],
    epoch: u64,
    binding: [u8; 32],
    debtors: Vec<Debtor>,
    winners: Vec<Winner>,
    // D121 order, winner first and then debtor.
    edges: Vec<Edge>,
    size: BigUint,
}

impl Book {
    pub fn from_members(
        venue: &[u8; 32],
        epoch: u64,
        freeze: &[u8; 32],
        mark: u64,
        insurance: u64,
        rows: &[Member],
    ) -> Result<Self> {
        if rows.is_empty()
            || !rows.windows(2).all(|pair| pair[0].id < pair[1].id)
            || !(1..=MAX_PRICE).contains(&mark)
            || insurance > MAX_CASH
        {
            return Err(Error::Cohort);
        }
        let mut binding = Hasher::default();
        binding.hashv(&[
            b"Rivalt/whole-single-market-search/v1\0",
            venue,
            &epoch.to_le_bytes(),
            freeze,
            &(rows.len() as u64).to_le_bytes(),
            &mark.to_le_bytes(),
            &insurance.to_le_bytes(),
        ]);
        let (mut net_lots, mut net_claim, mut loss) = (0i128, 0i128, 0u128);
        let mut debtors = Vec::new();
        let mut creditors = Vec::new();
        for row in rows {
            if row.face_scaled % SCALE != 0
                || row.face_scaled.unsigned_abs() > MAX_SCALED as u128
                || row.cash > MAX_CASH
            {
                return Err(Error::Bounds);
            }
            let attribution = Attribution::read(row.history, row.lots)?;
            binding.hashv(&[
                &row.id.to_le_bytes(),
                &row.lots.to_le_bytes(),
                &row.face_scaled.to_le_bytes(),
                &row.cash.to_le_bytes(),
                &(row.history.len() as u64).to_le_bytes(),
                row.history,
            ]);
            net_lots = net_lots
                .checked_add(i128::from(row.lots))
                .ok_or(Error::Overflow)?;
            net_claim = net_claim
                .checked_add(row.face_scaled)
                .ok_or(Error::Overflow)?;
            if row.face_scaled < 0 {
                let owed = u64::try_from(row.face_scaled.unsigned_abs() / SCALE as u128)
                    .map_err(|_| Error::Overflow)?;
                let uncovered = owed.saturating_sub(row.cash);
                loss = loss
                    .checked_add(u128::from(uncovered))
                    .ok_or(Error::Overflow)?;
                if row.lots != 0 && uncovered > 0 {
                    debtors.push(Debtor {
                        id: row.id,
                        lots: row.lots,
                        budget: uncovered,
                    });
                }
            } else if row.face_scaled > 0 && row.lots != 0 {
                creditors.push((row, attribution));
            }
        }
        if net_lots != 0 || net_claim != 0 {
            return Err(Error::Cohort);
        }
        for debtor in &mut debtors {
            debtor.budget = if loss <= u128::from(insurance) {
                0
            } else {
                let covered = (u128::from(debtor.budget) * u128::from(insurance)).div_ceil(loss);
                debtor
                    .budget
                    .checked_sub(u64::try_from(covered).map_err(|_| Error::Overflow)?)
                    .ok_or(Error::Invariant)?
            };
        }
        debtors.retain(|debtor| debtor.budget > 0);
        let priority = |id| (member_priority(venue, epoch, id), id);
        debtors.sort_by_cached_key(|debtor| priority(debtor.id));
        creditors.sort_by_cached_key(|(row, _)| priority(row.id));
        let mut winners = Vec::new();
        let mut edges = Vec::new();
        let mut common = BigUint::one();
        let mut size = BigUint::one();
        for (row, attribution) in creditors {
            let winner = winners.len();
            let mut available = 0u64;
            for (index, debtor) in debtors.iter().enumerate() {
                if row.lots.signum() == debtor.lots.signum() {
                    continue;
                }
                let paired = row.lots.unsigned_abs().min(debtor.lots.unsigned_abs());
                let cap = attribution.charge_cap(row.lots, mark, row.face_scaled, paired)?;
                if cap == 0 {
                    continue;
                }
                available = available
                    .saturating_add(paired)
                    .min(row.lots.unsigned_abs());
                let maximum = cap.min(debtor.budget);
                edges.push(Edge {
                    debtor: index,
                    winner,
                    maximum,
                });
                size *= u128::from(maximum) + 1;
            }
            if available == 0 {
                continue;
            }
            let terms = attribution.frozen_capacity(row.lots, mark, row.face_scaled, available)?;
            common = common.lcm(&BigUint::from(terms.eligible));
            winners.push(Winner {
                id: row.id,
                lots: row.lots,
                terms,
                weight: BigUint::zero(),
            });
        }
        // At fixed total recovery the proportional score differs from sum(q²/c)
        // only by a constant. A common multiple compares those sums exactly.
        for winner in &mut winners {
            winner.weight = &common / winner.terms.eligible;
        }
        Ok(Self {
            binding: binding.result().to_bytes(),
            venue: *venue,
            epoch,
            debtors,
            winners,
            edges,
            size,
        })
    }

    pub fn candidates(&self) -> &BigUint {
        &self.size
    }

    pub fn pair_order(&self) -> impl Iterator<Item = (u64, u64)> + '_ {
        self.edges
            .iter()
            .map(|edge| (self.debtors[edge.debtor].id, self.winners[edge.winner].id))
    }

    fn digits(&self, ordinal: &BigUint) -> Result<Vec<u64>> {
        if ordinal >= &self.size {
            return Err(Error::Bounds);
        }
        let mut remaining = ordinal.clone();
        Ok(self
            .edges
            .iter()
            .map(|edge| {
                let (rest, digit) = remaining.div_rem(&BigUint::from(u128::from(edge.maximum) + 1));
                remaining = rest;
                digit
                    .to_u64()
                    .expect("digit is bounded by the u64 edge maximum")
            })
            .collect())
    }

    fn score(&self, charges: &[u64]) -> Result<Option<Score>> {
        if charges.len() != self.edges.len() {
            return Err(Error::Bounds);
        }
        let mut debtor_used = vec![(0u64, 0u64); self.debtors.len()];
        let mut winner_used = vec![(0u64, 0u64); self.winners.len()];
        let (mut recovered, mut closed) = (0u128, 0u128);
        for (edge, &charge) in self.edges.iter().zip(charges) {
            if charge == 0 {
                continue;
            }
            if charge > edge.maximum {
                return Ok(None);
            }
            let winner = &self.winners[edge.winner];
            let debtor = &self.debtors[edge.debtor];
            let matched = winner.terms.schedule(charge)?.matched;
            for (used, cash, lots) in [
                (&mut debtor_used[edge.debtor], debtor.budget, debtor.lots),
                (
                    &mut winner_used[edge.winner],
                    winner.terms.eligible,
                    winner.lots,
                ),
            ] {
                if charge > cash - used.0 || matched > lots.unsigned_abs() - used.1 {
                    return Ok(None);
                }
                used.0 += charge;
                used.1 += matched;
            }
            recovered = recovered
                .checked_add(u128::from(charge))
                .ok_or(Error::Overflow)?;
            closed = closed
                .checked_add(u128::from(matched))
                .ok_or(Error::Overflow)?;
        }
        let mut deviation = BigUint::zero();
        let charges = winner_used
            .into_iter()
            .zip(&self.winners)
            .map(|((charge, _), winner)| {
                deviation += &winner.weight * (u128::from(charge) * u128::from(charge));
                charge
            })
            .collect();
        Ok(Some(Score {
            recovered,
            deviation,
            closed,
            charges,
        }))
    }

    /// Trusted storage owns the returned cursor. A caller cannot select its start.
    pub fn begin(&self, proposed: Vec<u64>) -> Result<Audit> {
        let score = self.score(&proposed)?.ok_or(Error::Cohort)?;
        Ok(Audit {
            binding: self.binding,
            proposed,
            score,
            next: BigUint::zero(),
            verdict: Verdict::Pending,
        })
    }
}

struct Score {
    recovered: u128,
    deviation: BigUint,
    closed: u128,
    charges: Vec<u64>,
}
impl Score {
    fn compare(&self, other: &Self) -> Ordering {
        self.recovered
            .cmp(&other.recovered)
            .then_with(|| other.deviation.cmp(&self.deviation))
            .then_with(|| other.closed.cmp(&self.closed))
            .then_with(|| self.charges.cmp(&other.charges))
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Pending,
    Outscored(BigUint),
    Verified,
}

/// Saved only by a trusted journal after completing the preceding range.
/// A digest authenticates the proposal identity, not the work in a skipped range.
#[derive(Clone, PartialEq, Eq)]
pub struct TrustedPrefix {
    pub proposal_binding: [u8; 32],
    pub next: BigUint,
}

pub struct Audit {
    binding: [u8; 32],
    proposed: Vec<u64>,
    score: Score,
    next: BigUint,
    verdict: Verdict,
}

impl Audit {
    fn proposal_binding(&self) -> [u8; 32] {
        let mut hash = Hasher::default();
        hash.hashv(&[b"Rivalt/multi-lot-charge-proposal/v1\0", &self.binding]);
        for charge in &self.proposed {
            hash.hash(&charge.to_le_bytes());
        }
        hash.result().to_bytes()
    }
    pub fn checkpoint(&self) -> Result<TrustedPrefix> {
        if self.verdict != Verdict::Pending {
            return Err(Error::Generation);
        }
        Ok(TrustedPrefix {
            proposal_binding: self.proposal_binding(),
            next: self.next.clone(),
        })
    }
    pub fn resume_trusted(book: &Book, proposal: Vec<u64>, saved: TrustedPrefix) -> Result<Self> {
        let mut audit = book.begin(proposal)?;
        if saved.proposal_binding != audit.proposal_binding() || saved.next >= book.size {
            return Err(Error::Generation);
        }
        audit.next = saved.next;
        Ok(audit)
    }
    pub fn certified_pairs(&self, book: &Book) -> Result<Vec<(u64, u64, PairedLots)>> {
        if self.verdict != Verdict::Verified
            || self.binding != book.binding
            || self.next != book.size
        {
            return Err(Error::Generation);
        }
        book.edges
            .iter()
            .zip(&self.proposed)
            .filter(|(_, charge)| **charge != 0)
            .map(|(edge, &charge)| {
                let winner = &book.winners[edge.winner];
                Ok((
                    book.debtors[edge.debtor].id,
                    winner.id,
                    winner.terms.schedule(charge)?,
                ))
            })
            .collect()
    }
    pub fn cursor(&self) -> &BigUint {
        &self.next
    }
    pub fn verdict(&self) -> &Verdict {
        &self.verdict
    }
    pub fn advance(
        &mut self,
        book: &Book,
        expected: &BigUint,
        budget: NonZeroU32,
    ) -> Result<&Verdict> {
        if self.binding != book.binding
            || expected != &self.next
            || self.verdict != Verdict::Pending
        {
            return Err(Error::Generation);
        }
        let end = (&self.next + budget.get()).min(book.size.clone());
        while self.next < end {
            let charges = book.digits(&self.next)?;
            let beats = book.score(&charges)?.is_some_and(|score| {
                score
                    .compare(&self.score)
                    .then_with(|| charges.cmp(&self.proposed))
                    .is_gt()
            });
            if beats {
                self.verdict = Verdict::Outscored(self.next.clone());
            }
            self.next += 1u32;
            if beats {
                return Ok(&self.verdict);
            }
        }
        if self.next == book.size {
            self.verdict = Verdict::Verified;
        }
        Ok(&self.verdict)
    }
}

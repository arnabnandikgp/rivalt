//! Exact bounded rate certificates with frozen principal weights, market-local
//! insurance and protected whole-atom settlement. Each pass uses a common unit.
extern crate alloc;
use alloc::{vec, vec::Vec};
use clearing_accounting::attribution::FrozenCapacity;
#[cfg(test)]
use financial_core::SCALE;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    DefaultCharge,
    DefaultRoster,
    Incomplete,
    UnsupportedBook,
}

pub type Result<T> = core::result::Result<T, Error>;
macro_rules! require {
    ($condition:expr, $error:expr $(,)?) => {
        if !$condition {
            return Err($error);
        }
    };
}
fn checked<T>(value: clearing_accounting::Result<T>) -> Result<T> {
    value.map_err(|_| Error::UnsupportedBook)
}

#[derive(Clone, Copy)]
pub struct Episode<'a> {
    pub venue: &'a [u8; 32],
    pub ordinal: u64,
    pub member_ids: &'a [u64],
    pub market_ids: &'a [u16],
    pub capacities: &'a [(usize, usize, FrozenCapacity)],
}
#[derive(Clone)]
pub struct WinnerSplit {
    pub members: [u8; 2],
    pub charges: [u64; 2],
    pub lots: [u64; 2],
}

pub const WIDTH: usize = 8;
pub const MEMBERS: usize = 12;
const PLANS: usize = 16;
type Columns = [u64; WIDTH];

#[derive(Clone)]
pub struct RatesProof {
    /// Zero selects a distinct denominator before the rates of each insurance pass.
    pub denominator: u32,
    pub selected: u8,
    /// Candidate-major, then sorted market ID. Mixed radix, first market fastest.
    pub numerators: Vec<u32>,
}

#[derive(Default, Clone, Copy)]
pub struct Cell {
    pub claim: i32,
    pub lots: i64,
    pub eligible: u32,
}
pub struct Member {
    pub cash: u32,
    pub cells: Vec<Cell>,
}
#[derive(Default, Copy, Clone)]
struct Pair {
    debtor: usize,
    winner: usize,
    maximum: u64,
    // When two winners share a market, the first bears the rest of its total charge.
    second: Option<(usize, u64)>,
}
impl Pair {
    fn charge_of(self, member: usize, total: u64) -> u64 {
        let second_charge = self.second.map_or(0, |(_, charge)| charge);
        if self.winner == member {
            total - second_charge
        } else if self.second.is_some_and(|(winner, _)| winner == member) {
            second_charge
        } else {
            0
        }
    }
}

struct Flow {
    unit: u64,
    loss: Columns,
    spent: Columns,
    pools: Columns,
    // Magnitudes. The original claim sign distinguishes a collection from a receipt.
    payments: Vec<Columns>,
    cash: [u64; MEMBERS],
}

struct Book<'a> {
    width: usize,
    rows: &'a [Member],
    principal: [u64; MEMBERS],
    reserves: Columns,
    pools: Columns,
}

fn exact_share(amount: u64, weight: u64, total: u64) -> Result<u64> {
    if weight == total || amount == 0 {
        return Ok(amount);
    }
    let numerator = u128::from(amount) * u128::from(weight);
    require!(numerator % u128::from(total) == 0, Error::DefaultCharge);
    Ok((numerator / u128::from(total)) as u64)
}

impl Flow {
    fn empty(count: usize) -> Self {
        Self {
            unit: 0,
            loss: [0; WIDTH],
            spent: [0; WIDTH],
            pools: [0; WIDTH],
            payments: vec![[0; WIDTH]; count],
            cash: [0; MEMBERS],
        }
    }
}

impl<'a> Book<'a> {
    fn new(rows: &'a [Member], pools: &[u64], reserves: &[u64]) -> Result<Self> {
        let width = pools.len();
        require!(
            (1..=WIDTH).contains(&width)
                && reserves.len() == width
                && (1..=MEMBERS).contains(&rows.len()),
            Error::UnsupportedBook
        );
        let mut book = Self {
            width,
            rows,
            principal: [0; MEMBERS],
            reserves: [0; WIDTH],
            pools: [0; WIDTH],
        };
        book.reserves[..width].copy_from_slice(reserves);
        book.pools[..width].copy_from_slice(pools);
        let mut net = [0i64; WIDTH];
        let mut inventory = [0i128; WIDTH];
        let mut gross: u128 = reserves.iter().chain(pools).map(|&v| u128::from(v)).sum();
        for (i, row) in rows.iter().enumerate() {
            require!(row.cells.len() == width, Error::DefaultRoster);
            gross += u128::from(row.cash);
            for (m, cell) in row.cells.iter().enumerate() {
                net[m] += i64::from(cell.claim);
                inventory[m] += i128::from(cell.lots);
                if cell.claim < 0 {
                    book.principal[i] += u64::from(cell.claim.unsigned_abs());
                } else {
                    gross += cell.claim as u128;
                }
            }
        }
        require!(
            gross <= u128::from(u32::MAX)
                && net
                    .iter()
                    .zip(book.pools)
                    .all(|(&claim, pool)| i128::from(claim) == i128::from(pool))
                && inventory == [0; WIDTH],
            Error::UnsupportedBook
        );
        Ok(book)
    }

    fn gain(&self, i: usize, m: usize, pairs: &[Pair], charges: &Columns) -> u64 {
        let gain = self.rows[i].cells[m].claim.max(0) as u64;
        gain - pairs[m].charge_of(i, charges[m])
    }

    // Keep the original cash split. Forward new receipts by original principal
    // weights, removing capped destinations before dividing the remaining amount.
    #[inline(never)]
    fn forward(
        &self,
        i: usize,
        charges: &Columns,
        pairs: &[Pair],
        flow: &mut Flow,
        incoming: u64,
    ) -> Result<u16> {
        let row = &self.rows[i];
        let principal = self.principal[i];
        let own = u64::from(row.cash).min(principal);
        let mut remaining = [0u64; WIDTH];
        let mut open = 0u16;
        let mut weight = 0;
        for (m, cell) in row.cells.iter().enumerate().filter(|(_, c)| c.claim < 0) {
            let owed = u64::from(cell.claim.unsigned_abs());
            let collection = exact_share(own * flow.unit, owed, principal)?;
            let charge = if pairs[m].debtor == i { charges[m] } else { 0 };
            remaining[m] = ((owed - charge) * flow.unit)
                .checked_sub(collection)
                .ok_or(Error::DefaultCharge)?;
            flow.payments[i][m] = collection;
            if remaining[m] > 0 {
                open |= 1 << m;
                weight += owed;
            }
        }
        let mut available = incoming;
        while open != 0 && available != 0 {
            let saturated = (0..self.width).find(|&m| {
                open & (1 << m) != 0
                    && u128::from(available) * u128::from(row.cells[m].claim.unsigned_abs())
                        >= u128::from(remaining[m]) * u128::from(weight)
            });
            if let Some(m) = saturated {
                flow.payments[i][m] += remaining[m];
                available -= remaining[m];
                weight -= u64::from(row.cells[m].claim.unsigned_abs());
                open &= !(1 << m);
            } else {
                for m in (0..self.width).filter(|&m| open & (1 << m) != 0) {
                    flow.payments[i][m] += exact_share(
                        available,
                        u64::from(row.cells[m].claim.unsigned_abs()),
                        weight,
                    )?;
                }
                available = 0;
            }
        }
        flow.cash[i] = (u64::from(row.cash) - own) * flow.unit + available;
        Ok(open)
    }

    #[inline(never)]
    fn evaluate(
        &self,
        rates: &[u32],
        pairs: &[Pair],
        charges: &Columns,
        budgets: &Columns,
        flow: &mut Flow,
    ) -> Result<Columns> {
        let unit = flow.unit;
        require!(
            rates.iter().all(|&rate| u64::from(rate) <= unit),
            Error::DefaultCharge
        );
        let mut face = [0u64; WIDTH];
        flow.pools = self.pools;
        let mut backing = self.pools.map(|atoms| atoms * unit);
        let mut open = [0u16; MEMBERS];
        for (i, row) in self.rows.iter().enumerate() {
            let mut incoming = 0;
            for (m, &rate) in rates.iter().enumerate() {
                let gain = self.gain(i, m, pairs, charges);
                face[m] += gain;
                flow.payments[i][m] = gain * u64::from(rate);
                incoming += flow.payments[i][m];
            }
            open[i] = self.forward(i, charges, pairs, flow, incoming)?;
            for (m, _) in row.cells.iter().enumerate().filter(|(_, c)| c.claim < 0) {
                backing[m] += flow.payments[i][m];
            }
        }
        let mut drains = 0u16;
        let mut clipped = *budgets;
        for (m, &rate) in rates.iter().enumerate() {
            let paid = face[m] * u64::from(rate);
            require!(
                paid == (backing[m] + budgets[m] * unit).min(face[m] * unit)
                    && (face[m] != 0 || u64::from(rate) == unit),
                Error::DefaultCharge
            );
            let used = paid.checked_sub(backing[m]).ok_or(Error::DefaultCharge)?;
            flow.spent[m] = used / unit;
            if used % unit != 0 {
                clipped[m] = used / unit;
            }
            flow.loss[m] = face[m] * unit - paid;
            if u64::from(rate) == unit {
                drains |= 1 << m;
            }
        }
        // Each still-open destination has positive marginal weight until its cap.
        // A path to par, or to a member with no open debt, leaks a strictly
        // positive part of any increment. A larger fixed point cannot fund it.
        for _ in 0..self.width {
            let previous = drains;
            for (i, row) in self.rows.iter().enumerate() {
                if open[i] != 0 && open[i] & drains == 0 {
                    continue;
                }
                for m in 0..row.cells.len() {
                    if self.gain(i, m, pairs, charges) > 0 {
                        drains |= 1 << m;
                    }
                }
            }
            if previous == drains {
                break;
            }
        }
        require!(drains == (1 << self.width) - 1, Error::DefaultCharge);
        Ok(clipped)
    }

    fn read_plan(
        &self,
        words: &mut &[u32],
        global_unit: u32,
        pairs: &[Pair],
        charges: &Columns,
        flow: &mut Flow,
    ) -> Result<()> {
        let mut budgets = self.reserves;
        for _ in 0..=self.width {
            let unit = if global_unit == 0 {
                let (next, rest) = words.split_first().ok_or(Error::Incomplete)?;
                *words = rest;
                *next
            } else {
                global_unit
            };
            require!(unit > 0, Error::DefaultCharge);
            flow.unit = u64::from(unit);
            let (rates, rest) = words
                .split_at_checked(self.width)
                .ok_or(Error::Incomplete)?;
            *words = rest;
            let clipped = self.evaluate(rates, pairs, charges, &budgets, flow)?;
            if budgets == clipped {
                return Ok(());
            }
            budgets = clipped;
        }
        Err(Error::UnsupportedBook.into())
    }

    fn pairs(&self, baseline: &Flow) -> Result<([Pair; WIDTH], usize, Vec<competition::Contest>)> {
        let mut pairs = [Pair::default(); WIDTH];
        let mut count = 1;
        let mut opportunities = Vec::new();
        let mut single_only = true;
        for (m, pair) in pairs.iter_mut().enumerate().take(self.width) {
            let occupied = self.rows.iter().filter(|r| r.cells[m].lots != 0).count();
            for (d, debtor) in self.rows.iter().enumerate() {
                if debtor.cells[m].claim >= 0 || debtor.cells[m].lots == 0 || baseline.loss[m] == 0
                {
                    continue;
                }
                let unpaid = u64::from(debtor.cells[m].claim.unsigned_abs()) * baseline.unit
                    - baseline.payments[d][m];
                let residual = baseline.loss[m] + baseline.spent[m] * baseline.unit;
                let budget = ((u128::from(unpaid) * u128::from(baseline.loss[m]))
                    / (u128::from(residual) * u128::from(baseline.unit)))
                    as u64;
                if budget == 0 {
                    continue;
                }
                for (w, winner) in self.rows.iter().enumerate() {
                    let cell = winner.cells[m];
                    if cell.eligible == 0
                        || debtor.cells[m].lots.signum() != -cell.lots.signum()
                        || cell.lots == 0
                    {
                        continue;
                    }
                    let maximum = budget
                        .min(u64::from(cell.eligible))
                        .min(cell.claim.max(0) as u64);
                    require!(maximum > 0, Error::UnsupportedBook);
                    if pair.maximum == 0 {
                        *pair = Pair {
                            debtor: d,
                            winner: w,
                            maximum,
                            second: None,
                        };
                        opportunities.push(competition::Contest {
                            market: m,
                            debtor: d,
                            first: w,
                            second: None,
                            budget,
                        });
                    } else {
                        let group = opportunities.last_mut().ok_or(Error::DefaultCharge)?;
                        require!(
                            group.market == m && group.debtor == d && group.second.is_none(),
                            Error::UnsupportedBook
                        );
                        group.second = Some(w);
                        single_only = false;
                    }
                }
            }
            if pair.maximum != 0
                && opportunities
                    .last()
                    .is_some_and(|g| g.market == m && g.second.is_none())
            {
                require!(occupied == 2, Error::UnsupportedBook);
            }
        }
        if single_only {
            // The original one-winner proof enumerates all totals, including zero.
            for pair in pairs.iter().take(self.width) {
                // For a large search, try only the proof that every market reaches its
                // upper bound. A smaller total cannot overtake such a recovery.
                if pair.maximum >= PLANS as u64 || count > PLANS / (pair.maximum as usize + 1) {
                    return Ok((pairs, 0, opportunities));
                }
                count *= pair.maximum as usize + 1;
            }
            opportunities.clear();
        }
        Ok((pairs, count, opportunities))
    }

    fn rank(
        &self,
        baseline: &Flow,
        flow: &Flow,
        pairs: &[Pair],
        charges: &Columns,
    ) -> Option<i128> {
        let targets = charges.iter().filter(|&&c| c > 0).count();
        let mut score = 0;
        for m in 0..self.width {
            let improvement = i128::from(baseline.loss[m]) * i128::from(flow.unit)
                - i128::from(flow.loss[m]) * i128::from(baseline.unit);
            if charges[m] != 0 {
                score +=
                    improvement.min(i128::from(charges[m] * flow.unit) * i128::from(baseline.unit));
            }
            if targets <= usize::from(charges[m] > 0) {
                continue;
            }
            if improvement < 0 || flow.spent[m] > baseline.spent[m] {
                return None;
            }
            for (i, _) in self
                .rows
                .iter()
                .enumerate()
                .filter(|(_, r)| r.cells[m].claim > 0)
            {
                let direct = pairs[m].charge_of(i, charges[m]);
                if u128::from(flow.payments[i][m] + direct * flow.unit) * u128::from(baseline.unit)
                    < u128::from(baseline.payments[i][m]) * u128::from(flow.unit)
                {
                    return None;
                }
            }
        }
        Some(score)
    }
}

fn allocation(mut index: usize, pairs: &[Pair]) -> Columns {
    let mut charges = [0; WIDTH];
    for (m, pair) in pairs.iter().enumerate() {
        let radix = pair.maximum as usize + 1;
        charges[m] = (index % radix) as u64;
        index /= radix;
    }
    charges
}

pub struct Posting {
    /// Signed whole-atom change of claims from forced reductions.
    pub claim_delta: [i64; WIDTH],
    /// Actual whole-atom cash transfers, positive when this account receives.
    pub movement: [i64; WIDTH],
}
pub struct Verified {
    pub postings: Vec<Posting>,
    pub checked_plans: usize,
    pub selected_ordinal: usize,
    pub cash: Vec<u64>,
    pub spent: Columns,
    pub repaired: bool,
    pub charges: [u64; WIDTH],
    pub winners: [usize; WIDTH],
    pub splits: Vec<(usize, WinnerSplit)>,
}

mod competition;
mod rounding;
use rounding::protected_cash;

#[cfg(test)]
fn verify(rows: &[Member], reserves: &[u64], proof: &RatesProof) -> Result<Verified> {
    verify_book(rows, &[0; WIDTH][..reserves.len()], reserves, proof, None)
}

pub fn verify_book(
    rows: &[Member],
    pools: &[u64],
    reserves: &[u64],
    proof: &RatesProof,
    context: Option<Episode>,
) -> Result<Verified> {
    verify_settlement(rows, pools, reserves, proof, context, false)
}

/// Apply the same recovery rules to an episode whose debtor insolvency and
/// complete membership have already been authenticated by the clearing program.
pub fn verify_frozen_book(
    rows: &[Member],
    pools: &[u64],
    reserves: &[u64],
    proof: &RatesProof,
    episode: Episode,
) -> Result<Verified> {
    verify_settlement(rows, pools, reserves, proof, Some(episode), true)
}

fn verify_settlement(
    rows: &[Member],
    pools: &[u64],
    reserves: &[u64],
    proof: &RatesProof,
    context: Option<Episode>,
    authenticated_freeze: bool,
) -> Result<Verified> {
    let book = Book::new(rows, pools, reserves)?;
    if let Some(episode) = context {
        require!(
            episode.ordinal > 0
                && episode.member_ids.len() == rows.len()
                && episode.market_ids.len() == pools.len()
                && episode.market_ids.windows(2).all(|ids| ids[0] < ids[1])
                && episode.member_ids.windows(2).all(|ids| ids[0] < ids[1]),
            Error::DefaultRoster
        );
    }
    let mut words = proof.numerators.as_slice();
    let mut baseline = Flow::empty(rows.len());
    book.read_plan(
        &mut words,
        proof.denominator,
        &[Pair::default(); WIDTH],
        &[0; WIDTH],
        &mut baseline,
    )?;
    let (mut pairs, count, opportunities) = book.pairs(&baseline)?;
    let selected = usize::from(proof.selected);
    let mut splits = Vec::new();
    let mut charges = [0; WIDTH];
    let mut checked_plans = count;
    let mut selected_ordinal = selected;
    let (payout, repaired, spent) = if !opportunities.is_empty() {
        let (terminal, result, ordinal, examined) = competition::verify(
            &opportunities,
            &book,
            &baseline,
            &mut pairs,
            &mut charges,
            proof,
            &mut words,
            context.ok_or(Error::UnsupportedBook)?,
        )?;
        let (cash, repaired) = protected_cash(rows, &baseline, &terminal, &pairs, &charges)?;
        splits = result;
        checked_plans = examined;
        selected_ordinal = ordinal;
        (cash, repaired, terminal.spent)
    } else if count == 1 {
        // A previously authenticated default can finish when verified market
        // insurance alone covers the gap. An ordinary par book cannot initiate settlement.
        let incurred_loss = baseline.loss.iter().any(|&loss| loss > 0);
        let covered_by_insurance = authenticated_freeze && baseline.spent.iter().any(|&draw| draw > 0);
        require!(
            selected == 0 && (incurred_loss || covered_by_insurance),
            Error::DefaultCharge
        );
        require!(words.is_empty(), Error::Incomplete);
        (
            rounding::baseline_cash(rows, &baseline)?,
            false,
            baseline.spent,
        )
    } else {
        charges = allocation(selected, &pairs);
        let terminal = verify_reduction(
            &book,
            &baseline,
            &pairs,
            count,
            selected,
            proof.denominator,
            &mut words,
        )?;
        let (cash, repaired) = protected_cash(rows, &baseline, &terminal, &pairs, &charges)?;
        (cash, repaired, terminal.spent)
    };
    let mut market_movements = [0i128; WIDTH];
    let mut net_delta = [0i128; WIDTH];
    let mut postings = Vec::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        let mut posting = Posting {
            claim_delta: [0; WIDTH],
            movement: [0; WIDTH],
        };
        let mut final_cash = i128::from(row.cash);
        for (market, cell) in row.cells.iter().enumerate() {
            let pair = pairs[market];
            let charge = charges[market];
            let debtor_relief = if pair.debtor == index { charge } else { 0 };
            let delta = i128::from(debtor_relief) - i128::from(pair.charge_of(index, charge));
            let effective = i128::from(cell.claim) + delta;
            let paid = i128::from(payout.payments[index][market]);
            require!(paid <= effective.abs(), Error::UnsupportedBook);
            let movement = effective.signum() * paid;
            posting.claim_delta[market] =
                i64::try_from(delta).map_err(|_| Error::UnsupportedBook)?;
            posting.movement[market] =
                i64::try_from(movement).map_err(|_| Error::UnsupportedBook)?;
            final_cash += movement;
            market_movements[market] += movement;
            net_delta[market] += delta;
        }
        require!(
            final_cash == i128::from(payout.cash[index]),
            Error::UnsupportedBook
        );
        postings.push(posting);
    }
    for market in 0..book.width {
        require!(
            net_delta[market] == 0
                && market_movements[market]
                    == i128::from(pools[market]) + i128::from(spent[market]),
            Error::UnsupportedBook
        );
    }
    Ok(Verified {
        cash: payout.cash,
        postings,
        checked_plans,
        selected_ordinal,
        spent,
        repaired,
        charges,
        winners: pairs.map(|p| p.winner),
        splits,
    })
}

#[inline(never)]
fn verify_reduction(
    book: &Book<'_>,
    baseline: &Flow,
    pairs: &[Pair],
    count: usize,
    selected: usize,
    denominator: u32,
    words: &mut &[u32],
) -> Result<Flow> {
    require!(selected > 0 && selected < count, Error::DefaultCharge);
    let mut scratch = Flow::empty(book.rows.len());
    let mut terminal = Flow::empty(book.rows.len());
    let mut best = None;
    let mut rival = (0i128, 1u64); // No action recovers zero.
    for index in 1..count {
        let charges = allocation(index, pairs);
        book.read_plan(words, denominator, pairs, &charges, &mut scratch)?;
        let score = book.rank(baseline, &scratch, pairs, &charges);
        if index == selected {
            best = score;
            core::mem::swap(&mut terminal, &mut scratch);
        } else if let Some(score) = score {
            if greater(score, scratch.unit, rival.0, rival.1)? {
                rival = (score, scratch.unit);
            }
        }
    }
    require!(words.is_empty(), Error::Incomplete);
    require!(
        greater(
            best.ok_or(Error::DefaultCharge)?,
            terminal.unit,
            rival.0,
            rival.1
        )?,
        Error::DefaultCharge
    );
    Ok(terminal)
}

// Scores have a common baseline denominator which cancels on comparison.
fn greater(left: i128, left_unit: u64, right: i128, right_unit: u64) -> Result<bool> {
    Ok(left
        .checked_mul(right_unit.into())
        .ok_or(Error::UnsupportedBook)?
        > right
            .checked_mul(left_unit.into())
            .ok_or(Error::UnsupportedBook)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precollected_cash_and_one_large_charge_reconcile_without_enumerating_atoms() {
        let rows = [
            (11_504, -19_002, -1),
            (12_500, 19_002, 1),
            (999_974, 996, 0),
        ]
        .map(|(cash, claim, lots)| Member {
            cash,
            cells: vec![
                Cell {
                    claim,
                    lots,
                    eligible: if lots == 1 { 19_002 } else { 0 },
                },
                Cell::default(),
            ],
        });
        let basis = clearing_accounting::attribution::Attribution::default()
            .fill(0, 1, 60_998)
            .unwrap();
        let capacities = [(
            1,
            0,
            basis.frozen_capacity(1, 80_000, 19_002 * SCALE, 1).unwrap(),
        )];
        let episode = Episode {
            venue: &[7; 32],
            ordinal: 3,
            member_ids: &[2, 91, 1024],
            market_ids: &[0, 1],
            capacities: &capacities,
        };
        let proof = RatesProof {
            selected: 1,
            denominator: 0,
            numerators: vec![9999, 6253, 9999, 1, 1, 1],
        };
        let plan = verify_book(&rows, &[996, 0], &[6, 0], &proof, Some(episode)).unwrap();
        assert_eq!(plan.cash, [0, 24_010, 1_000_970]);
        assert_eq!(plan.postings.iter().map(|p| (p.claim_delta[0],p.movement[0])).collect::<Vec<_>>(),
            [(7492,-11504),(-7492,11510),(0,996)]);
        assert!(plan.postings.iter().all(|p|p.claim_delta[1]==0 && p.movement[1]==0));
        assert_eq!(&plan.charges[..2], &[7492, 0]);
        assert_eq!(&plan.spent[..2], &[6, 0]);
        assert!(verify_book(&rows, &[0, 996], &[6, 0], &proof, Some(episode)).is_err());
        assert!(verify_book(&rows, &[995, 0], &[6, 0], &proof, Some(episode)).is_err());
        assert!(verify_book(
            &rows,
            &[996, 0],
            &[6, 0],
            &proof,
            Some(Episode {
                member_ids: &[2, 2, 3],
                ..episode
            })
        )
        .is_err());
    }

    #[test]
    fn residual_requires_post_insurance_loss_and_no_available_reduction() {
        let rows = |cash, winning_capacity| {
            [(cash, -6, -1, 0), (10, 6, 1, winning_capacity)].map(
                |(cash, claim, lots, eligible)| Member {
                    cash,
                    cells: vec![Cell {
                        claim,
                        lots,
                        eligible,
                    }],
                },
            )
        };
        let baseline = |paid| RatesProof {
            denominator: 6,
            selected: 0,
            numerators: vec![paid],
        };
        // A reset winning entry leaves the six-atom claim outstanding but no
        // open profit to charge. Four debtor atoms plus one reserve atom pay five.
        let plan = verify(&rows(4, 0), &[1], &baseline(5)).unwrap();
        assert_eq!(plan.cash, [0, 15]);
        assert_eq!(plan.spent[0], 1);
        assert_eq!(plan.charges, [0; WIDTH]);
        assert!(!plan.repaired);
        assert!(verify(&rows(4, 0), &[1], &baseline(4)).is_err());
        assert!(verify(&rows(6, 0), &[0], &baseline(6)).is_err());
        assert!(verify(&rows(4, 0), &[2], &baseline(6)).is_err());
        assert!(verify(&rows(4, 1), &[1], &baseline(5)).is_err());
        let frozen = Episode {
            venue: &[5; 32], ordinal: 1, member_ids: &[0, 1], market_ids: &[0], capacities: &[],
        };
        let paid = verify_frozen_book(&rows(4, 0), &[0], &[3], &baseline(6), frozen).unwrap();
        assert_eq!(paid.cash, [0, 16]);
        assert_eq!(paid.spent[0], 2);
        assert_eq!(paid.charges[0], 0);
        assert!(verify_frozen_book(&rows(6, 0), &[0], &[3], &baseline(6), frozen).is_err());
    }

    #[test]
    fn frozen_cash_stays_split_when_a_charge_caps_one_destination() {
        let rows = [
            (50, [-100, -100, 200]),
            (100, [0, 0, -200]),
            (0, [100, 0, 0]),
            (0, [0, 100, 0]),
        ]
        .into_iter()
        .map(|(cash, claims)| Member {
            cash,
            cells: claims
                .map(|claim| Cell {
                    claim,
                    ..Cell::default()
                })
                .to_vec(),
        })
        .collect::<Vec<_>>();
        let book = Book::new(&rows, &[0; 3], &[0, 0, 0]).unwrap();
        let mut flow = Flow::empty(rows.len());
        flow.unit = 1;
        let mut pairs = [Pair::default(); WIDTH];
        pairs[0] = Pair {
            debtor: 0,
            winner: 2,
            maximum: 40,
            second: None,
        };
        let charges = allocation(40, &pairs);
        // Own cash remains 25/25. Of the next 100 atoms, only 35 fit the
        // first destination after the charge. The second receives the other 65.
        assert_eq!(
            book.forward(0, &charges, &pairs, &mut flow, 100).unwrap(),
            0b010
        );
        assert_eq!(&flow.payments[0][..2], &[60, 90]);
    }

    #[test]
    fn individual_charge_budget_uses_the_insured_share_of_each_debt() {
        let rows =
            [(2, -8, -1, 0), (2, -4, 0, 0), (0, 12, 1, 12)].map(|(cash, claim, lots, eligible)| {
                Member {
                    cash,
                    cells: vec![Cell {
                        claim,
                        lots,
                        eligible,
                    }],
                }
            });
        let book = Book::new(&rows, &[0], &[2]).unwrap();
        let mut baseline = Flow::empty(rows.len());
        book.read_plan(
            &mut &[1u32][..],
            2,
            &[Pair::default(); WIDTH],
            &[0; WIDTH],
            &mut baseline,
        )
        .unwrap();
        let (pairs, count, _) = book.pairs(&baseline).unwrap();
        // Six of eight residual debt atoms belong to the first debtor. Its
        // uninsured writeoff is 6 * (8 - 2) / 8 = 4.5, admitting four whole atoms.
        assert_eq!((pairs[0].maximum, count), (4, 5));
    }

    #[test]
    fn a_fractional_reserve_draw_requires_verified_rates_before_and_after_clipping() {
        // The source pays 3/4. The linked member collects 3 of its own cash
        // and forwards 9/4 received, split equally. Each downstream owes 3.
        // At par the insured market would draw 3/8, so its budget clips to zero
        // and its rate drops to 7/8. The one-atom source concession pays all at par.
        let rows: Vec<_> = [
            (3, [-4, 0, 0]),
            (0, [1, 0, 0]),
            (3, [3, -3, -3]),
            (0, [0, 3, 0]),
            (0, [0, 0, 3]),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (cash, claims))| Member {
            cash,
            cells: claims
                .into_iter()
                .enumerate()
                .map(|(m, claim)| Cell {
                    claim,
                    lots: if m == 0 { [-1, 1, 0, 0, 0][i] } else { 0 },
                    eligible: u32::from(m == 0 && i == 1),
                })
                .collect(),
        })
        .collect();
        let proof = |words: &[u32]| RatesProof {
            denominator: 0,
            selected: 1,
            numerators: words.to_vec(),
        };
        let before = [8, 6, 8, 7];
        let clipped = [8, 6, 7, 7];
        let terminal = [2, 2, 2, 2];
        let reserves = [0, 1, 0];
        let plan = verify(
            &rows,
            &reserves,
            &proof(&[before, clipped, terminal].concat()),
        )
        .unwrap();
        assert_eq!(plan.cash, [0, 0, 0, 3, 3]);
        assert_eq!(&plan.spent[..3], &[0, 0, 0]);
        assert!(verify(&rows, &reserves, &proof(&[clipped, terminal].concat())).is_err());
        assert!(verify(&rows, &reserves, &proof(&[before, terminal].concat())).is_err());
    }
}

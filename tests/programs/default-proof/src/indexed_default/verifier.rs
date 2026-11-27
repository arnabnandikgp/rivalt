//! Bounded certificate for whole-atom frozen claims, one debt destination per
//! member, zero insurance, and at most one opposite pair in a charged market.
//! All amounts inside an evaluation use the same exact denominator.
use super::*;
pub(super) const WIDTH: usize = 8;
pub(super) const MEMBERS: usize = 12;
const PLANS: usize = 16;
type Columns = [u64; WIDTH];

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RatesProof {
    pub denominator: u32,
    pub selected: u8,
    /// Candidate-major, then sorted market ID. Mixed radix, first market fastest.
    pub numerators: Vec<u32>,
}

#[derive(Default, Clone, Copy)]
pub(super) struct Cell {
    pub claim: i32,
    pub lots: i64,
    pub eligible: u32,
}
pub(super) struct Member {
    pub cash: u32,
    pub cells: Vec<Cell>,
}
#[derive(Default, Copy, Clone)]
struct Pair {
    debtor: usize,
    winner: usize,
    maximum: u64,
}

struct Flow {
    loss: Columns,
    unpaid: [u64; MEMBERS],
    cash: [u64; MEMBERS],
}
struct Book<'a> {
    width: usize,
    rows: &'a [Member],
    debt: [Option<usize>; MEMBERS],
    collected: [u64; MEMBERS],
    unit: u64,
}

impl<'a> Book<'a> {
    fn new(rows: &'a [Member], width: usize, unit: u32) -> Result<Self> {
        require!(
            unit > 0 && (1..=WIDTH).contains(&width) && (1..=MEMBERS).contains(&rows.len()),
            ProofError::UnsupportedBook
        );
        let mut book = Self {
            width,
            rows,
            debt: [None; MEMBERS],
            collected: [0; MEMBERS],
            unit: unit.into(),
        };
        let mut net = [0i64; WIDTH];
        let mut inventory = [0i128; WIDTH];
        let mut gross = 0u64;
        for (i, row) in rows.iter().enumerate() {
            require!(row.cells.len() == width, ProofError::DefaultRoster);
            gross += u64::from(row.cash);
            for (m, cell) in row.cells.iter().enumerate() {
                net[m] += i64::from(cell.claim);
                inventory[m] += i128::from(cell.lots);
                if cell.claim < 0 {
                    require!(
                        book.debt[i].replace(m).is_none(),
                        ProofError::UnsupportedBook
                    );
                    book.collected[i] = u64::from(row.cash.min(cell.claim.unsigned_abs()));
                } else {
                    gross += cell.claim as u64;
                }
            }
        }
        // Bounds every nonnegative sum below, including total loss and cash, times unit.
        require!(
            gross <= u64::from(u32::MAX) && net == [0; WIDTH] && inventory == [0; WIDTH],
            ProofError::UnsupportedBook
        );
        Ok(book)
    }

    fn gain(&self, i: usize, m: usize, pairs: &[Pair], charges: &Columns) -> u64 {
        let gain = self.rows[i].cells[m].claim.max(0) as u64;
        if pairs[m].winner == i {
            gain - charges[m]
        } else {
            gain
        }
    }

    #[inline(never)]
    fn evaluate(&self, rates: &[u32], pairs: &[Pair], charges: &Columns) -> Result<Flow> {
        require!(
            rates.iter().all(|&rate| u64::from(rate) <= self.unit),
            ProofError::DefaultCharge
        );
        let mut flow = Flow {
            loss: [0; WIDTH],
            unpaid: [0; MEMBERS],
            cash: [0; MEMBERS],
        };
        let mut face = [0u64; WIDTH];
        let mut backing = [0u64; WIDTH];
        for (i, row) in self.rows.iter().enumerate() {
            let mut incoming = 0;
            for (m, &rate) in rates.iter().enumerate() {
                let gain = self.gain(i, m, pairs, charges);
                face[m] += gain;
                incoming += gain * u64::from(rate);
            }
            let mut forwarded = 0;
            if let Some(m) = self.debt[i] {
                let reduction = if pairs[m].debtor == i { charges[m] } else { 0 };
                let remaining =
                    u64::from(row.cells[m].claim.unsigned_abs()) - self.collected[i] - reduction;
                forwarded = incoming.min(remaining * self.unit);
                flow.unpaid[i] = remaining * self.unit - forwarded;
                backing[m] += self.collected[i] * self.unit + forwarded;
            }
            flow.cash[i] =
                (u64::from(row.cash) - self.collected[i]) * self.unit + incoming - forwarded;
        }
        let mut drains = 0u16;
        for (m, &rate) in rates.iter().enumerate() {
            let paid = face[m] * u64::from(rate);
            require!(
                paid == backing[m].min(face[m] * self.unit)
                    && (face[m] != 0 || u64::from(rate) == self.unit),
                ProofError::DefaultCharge
            );
            flow.loss[m] = face[m] * self.unit - paid;
            if u64::from(rate) == self.unit {
                drains |= 1 << m;
            }
        }
        // Relative to this fixed point, any positive increment in total payments
        // must pass through still-unpaid debt, dollar for dollar. A path to par or
        // to a member with no remaining debt leaks some of that increment. If every
        // market has such a path, no larger fixed point can fund its own increase.
        for _ in 0..self.width {
            let previous = drains;
            for (i, row) in self.rows.iter().enumerate() {
                if flow.unpaid[i] != 0 && self.debt[i].is_some_and(|d| drains & (1 << d) == 0) {
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
        require!(drains == (1 << self.width) - 1, ProofError::DefaultCharge);
        Ok(flow)
    }

    fn pairs(&self, baseline: &Flow) -> Result<([Pair; WIDTH], usize)> {
        let mut pairs = [Pair::default(); WIDTH];
        let mut count = 1;
        for (m, pair) in pairs.iter_mut().enumerate().take(self.width) {
            let occupied = self.rows.iter().filter(|r| r.cells[m].lots != 0).count();
            for (d, debtor) in self.rows.iter().enumerate() {
                if self.debt[d] != Some(m) || baseline.unpaid[d] < self.unit {
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
                    require!(
                        occupied == 2 && pair.maximum == 0,
                        ProofError::UnsupportedBook
                    );
                    let maximum = (baseline.unpaid[d] / self.unit)
                        .min(u64::from(cell.eligible))
                        .min(cell.claim.max(0) as u64);
                    require!(
                        maximum > 0 && maximum < PLANS as u64,
                        ProofError::UnsupportedBook
                    );
                    *pair = Pair {
                        debtor: d,
                        winner: w,
                        maximum,
                    };
                    count *= maximum as usize + 1;
                    require!(count <= PLANS, ProofError::UnsupportedBook);
                }
            }
        }
        Ok((pairs, count))
    }

    // For the winner, integral receipts and transfers make ordinary rounding
    // unique. For rivals, exact safety gives an upper bound even if rounding
    // could subsequently disqualify that rival.
    fn rank(
        &self,
        baseline: &Flow,
        before: &[u32],
        flow: &Flow,
        after: &[u32],
        pairs: &[Pair],
        charges: &Columns,
        winning: bool,
    ) -> Option<i128> {
        let targets = charges.iter().filter(|&&c| c > 0).count();
        let mut score = 0;
        for m in 0..self.width {
            let improvement = i128::from(baseline.loss[m]) - i128::from(flow.loss[m]);
            if charges[m] != 0 {
                score += improvement.min(i128::from(charges[m] * self.unit));
            }
            let protected = targets > usize::from(charges[m] > 0);
            if protected && improvement < 0 {
                return None;
            }
            for (i, row) in self.rows.iter().enumerate() {
                let current = self.gain(i, m, pairs, charges) * u64::from(after[m]);
                if winning && current % self.unit != 0 {
                    return None;
                }
                if protected {
                    let direct = if pairs[m].winner == i { charges[m] } else { 0 };
                    let original = row.cells[m].claim.max(0) as u64 * u64::from(before[m]);
                    if current + direct * self.unit < original {
                        return None;
                    }
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

pub(super) struct Verified {
    pub cash: Vec<u64>,
    pub charges: [u64; WIDTH],
    pub winners: [usize; WIDTH],
}

pub(super) fn verify(rows: &[Member], width: usize, proof: &RatesProof) -> Result<Verified> {
    let book = Book::new(rows, width, proof.denominator)?;
    let before = proof
        .numerators
        .get(..width)
        .ok_or(ProofError::Incomplete)?;
    let baseline = book.evaluate(before, &[Pair::default(); WIDTH], &[0; WIDTH])?;
    let (pairs, count) = book.pairs(&baseline)?;
    let selected = usize::from(proof.selected);
    require!(
        count > 1 && selected > 0 && selected < count,
        ProofError::DefaultCharge
    );
    require!(
        proof.numerators.len() == count * width,
        ProofError::Incomplete
    );
    let rates = |index: usize| &proof.numerators[index * width..(index + 1) * width];
    let charges = allocation(selected, &pairs);
    let terminal = book.evaluate(rates(selected), &pairs, &charges)?;
    let best = book
        .rank(
            &baseline,
            before,
            &terminal,
            rates(selected),
            &pairs,
            &charges,
            true,
        )
        .ok_or(ProofError::DefaultCharge)?;
    require!(best > 0, ProofError::DefaultCharge);
    for index in 1..count {
        if index == selected {
            continue;
        }
        let rival = allocation(index, &pairs);
        let flow = book.evaluate(rates(index), &pairs, &rival)?;
        let score = book.rank(
            &baseline,
            before,
            &flow,
            rates(index),
            &pairs,
            &rival,
            false,
        );
        require!(score.is_none_or(|s| s < best), ProofError::DefaultCharge);
    }
    let cash: Vec<_> = terminal.cash[..rows.len()]
        .iter()
        .map(|amount| amount / book.unit)
        .collect();
    require!(
        terminal.cash[..rows.len()]
            .iter()
            .all(|amount| amount % book.unit == 0)
            && cash.iter().sum::<u64>() == rows.iter().map(|r| u64::from(r.cash)).sum(),
        ProofError::UnsupportedBook
    );
    Ok(Verified {
        cash,
        charges,
        winners: pairs.map(|pair| pair.winner),
    })
}

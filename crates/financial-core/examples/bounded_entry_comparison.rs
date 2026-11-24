//! Native differential driver. Both bases see the same real position and market claim.
//! No deployment feature references this candidate.
use clearing_accounting::attribution::Attribution;
use financial_core::{Error, Participant, Result, MAX_PRICE, SCALE};
use std::io::{self, BufRead};

/// Scaled quote atoms attributable to the entire surviving position.
#[derive(Default)]
struct OpenCost(i128);

impl OpenCost {
    fn fill(&self, before: i64, after: i64, gross: u64) -> Result<Self> {
        let gross_scaled = i128::from(gross)
            .checked_mul(SCALE)
            .ok_or(Error::Overflow)?;
        let old_qty = i128::from(before.unsigned_abs());
        let left = i128::from(after.unsigned_abs());
        if left == 0 {
            return Ok(Self(0));
        }
        if before.signum() == after.signum() && left > old_qty {
            return self
                .0
                .checked_add(gross_scaled)
                .map(Self)
                .ok_or(Error::Overflow);
        }
        // A flip assigns a share of the execution gross to the new side. A reduction
        // assigns a share of the previous total to the lots still open.
        let (total, quantity) = if before.signum() == after.signum() {
            (self.0, old_qty)
        } else {
            (gross_scaled, i128::from(before.abs_diff(after)))
        };
        let numerator = total.checked_mul(left).ok_or(Error::Overflow)?;
        let quotient = numerator / quantity;
        let round_up = after < 0 && numerator % quantity != 0;
        Ok(Self(quotient + i128::from(round_up)))
    }

    fn ceilings(&self, lots: i64, mark: u64, claim: i128, available: u64) -> (i128, i128) {
        // The production reference validates the same lot, price and available-lot
        // domains before this comparison. Products are at most 10^23 scaled atoms.
        let open_gain = (i128::from(lots) * i128::from(mark) * SCALE
            - i128::from(lots.signum()) * self.0)
            .max(0);
        let ordinary = (claim - open_gain).max(0) / SCALE;
        let forced = if lots == 0 || claim <= 0 {
            0
        } else {
            let ticks = open_gain / (i128::from(lots.unsigned_abs()) * SCALE);
            let room = if lots > 0 { mark - 1 } else { MAX_PRICE - mark };
            (ticks.min(i128::from(room)) * i128::from(available)).min(claim / SCALE)
        };
        (ordinary, forced)
    }
}

#[derive(Default)]
struct Comparison {
    account: Participant,
    exact: Attribution,
    bounded: OpenCost,
}

fn main() {
    assert_eq!(std::mem::size_of::<OpenCost>(), 16);
    let mut comparison = Comparison::default();
    for input in io::stdin().lock().lines() {
        let input = input.unwrap();
        // Signed fill quantity (zero observes), gross quote atoms, mark, cumulative
        // funding index and number of surviving lots available for forced reduction.
        let fields: Vec<&str> = input.split_whitespace().collect();
        assert_eq!(fields.len(), 5);
        let delta: i64 = fields[0].parse().unwrap();
        let gross: u64 = fields[1].parse().unwrap();
        let mark: u64 = fields[2].parse().unwrap();
        let funding: i128 = fields[3].parse().unwrap();
        let available: u64 = fields[4].parse().unwrap();
        let old = comparison.account.lots;
        if delta != 0 {
            let next = comparison
                .account
                .quoted_fill(u8::from(delta < 0), delta.unsigned_abs(), gross, funding)
                .unwrap();
            comparison.exact = comparison.exact.fill(old, next.lots, gross).unwrap();
            comparison.bounded = comparison.bounded.fill(old, next.lots, gross).unwrap();
            comparison.account = next;
        }
        let lots = comparison.account.lots;
        let claim = comparison.account.unpaid(mark, funding).unwrap();
        let pay = comparison
            .exact
            .closed_quantity_payment_cap(lots, mark, claim)
            .unwrap();
        let charge = comparison
            .exact
            .charge_cap(lots, mark, claim, available)
            .unwrap();
        let (bounded_pay, bounded_charge) =
            comparison.bounded.ceilings(lots, mark, claim, available);
        println!(
            "{lots} {claim} {} {pay} {bounded_pay} {charge} {bounded_charge}",
            comparison.bounded.0
        );
    }
}

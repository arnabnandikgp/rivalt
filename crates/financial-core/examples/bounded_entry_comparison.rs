//! Native differential driver. Both bases see the same real position and market claim.
//! No deployment feature references this candidate.
#[path = "bounded_entry_comparison/interval.rs"]
mod interval;

use clearing_accounting::attribution::Attribution;
use financial_core::Participant;
use interval::{ceilings, EntryBounds};
use std::io::{self, BufRead};

#[derive(Default)]
struct Comparison {
    account: Participant,
    exact: Attribution,
    bounded: EntryBounds,
}

fn main() {
    assert_eq!(std::mem::size_of::<EntryBounds>(), 32);
    let show_bounds = std::env::args().nth(1).as_deref() == Some("--bounds");
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
        let (lower, lower_strict, upper, upper_strict) = comparison.bounded.scaled_endpoints();
        // The original single-cost experiment rounded long costs down and short costs up.
        let single_cost = if lots < 0 { upper } else { lower };
        let (bounded_pay, bounded_charge) = ceilings(2 * single_cost, lots, mark, claim, available);
        print!("{lots} {claim} {single_cost} {pay} {bounded_pay} {charge} {bounded_charge}");
        if show_bounds {
            print!(
                " {lower} {} {upper} {}",
                u8::from(lower_strict),
                u8::from(upper_strict)
            );
            for use_strict in [false, true] {
                let decision = comparison
                    .bounded
                    .certify(lots, mark, claim, available, use_strict);
                for amount in [decision.ordinary, decision.forced] {
                    match amount {
                        Some(value) => print!(" {value}"),
                        None => print!(" ?"),
                    }
                }
            }
        }
        println!();
    }
}

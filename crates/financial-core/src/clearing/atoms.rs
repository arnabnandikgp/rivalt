//! Whole-flow floors and the three deterministic outgoing remainder priorities.
use super::{
    row::Row,
    wide::{self, Wide},
};
use crate::{Error, Result, MAX_CASH};
use core::cmp::Ordering;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    pub flows: [u64; 2],
    pub cash: u64,
    pub fractional: [bool; 3],
    pub root_order: u64,
    pub residual: i64,
}

/// Scratch 0/1 retain the claim-flow remainders; 2 holds exact cash numerator;
/// 3 retains its remainder. The caller has already verified the complete rates.
pub fn plan(
    row: &Row,
    flows: [&Wide; 2],
    denominator: &Wide,
    scratch: [&mut Wide; 4],
) -> Result<Plan> {
    let [first, second, cash_numerator, cash_remainder] = scratch;
    let claim_remainders = [first, second];
    row.validate()?;
    if wide::bits(denominator) == 0 {
        return Err(Error::Bounds);
    }
    let mut whole = [0; 2];
    for index in 0..2 {
        if row.claims[index] == 0 && wide::bits(flows[index]) != 0 {
            return Err(Error::Invariant);
        }
        whole[index] = wide::divide_atoms(claim_remainders[index], flows[index], denominator)?;
    }
    wide::multiply(cash_numerator, denominator, &[row.cash])?;
    for index in 0..2 {
        if row.claims[index] > 0 {
            wide::add_assign(cash_numerator, flows[index])?;
        }
    }
    for index in 0..2 {
        if row.claims[index] < 0 {
            wide::subtract_assign(cash_numerator, flows[index])?;
        }
    }
    let cash = wide::divide_atoms(cash_remainder, cash_numerator, denominator)?;
    if cash < row.cash - row.collected()? || cash > MAX_CASH {
        return Err(Error::Invariant);
    }
    let remainders = [
        &*claim_remainders[0],
        &*claim_remainders[1],
        &*cash_remainder,
    ];
    let fractional = remainders.map(|value| wide::bits(value) != 0);
    let mut order = [0usize, 1, 2];
    // Three-element stable insertion sort. Lower destination ID wins equal
    // remainder; the cash sink follows both market nodes.
    for next in 1..3 {
        let mut current = next;
        while current > 0 {
            let comparison =
                wide::compare(remainders[order[current]], remainders[order[current - 1]]);
            if comparison != Ordering::Greater {
                break;
            }
            order.swap(current, current - 1);
            current -= 1;
        }
    }
    let mut residual = i128::from(row.cash) - i128::from(cash);
    for index in 0..2 {
        residual += row.claims[index].signum() * i128::from(whole[index]);
    }
    if !(-2..=2).contains(&residual) {
        return Err(Error::Invariant);
    }
    Ok(Plan {
        flows: whole,
        cash,
        fractional,
        root_order: order[0] as u64 | ((order[1] as u64) << 2) | ((order[2] as u64) << 4),
        residual: residual as i64,
    })
}

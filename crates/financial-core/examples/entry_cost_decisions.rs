//! Drive the deployed entry-cost codec and both payment rules against a signed position.
use clearing_accounting::entry_cost::EntryCost;
use financial_core::Participant;
use std::io::{self, BufRead};

fn main() {
    let mut account = Participant::default();
    let mut slot = [0u8; EntryCost::BYTES];
    for input in io::stdin().lock().lines() {
        let input = input.unwrap();
        let mut fields = input.split_whitespace();
        let delta: i64 = fields.next().unwrap().parse().unwrap();
        let gross: u64 = fields.next().unwrap().parse().unwrap();
        let mark = fields.next().unwrap().parse().unwrap();
        let funding = fields.next().unwrap().parse().unwrap();
        let matched = fields.next().unwrap().parse().unwrap();
        assert!(fields.next().is_none());
        if delta != 0 {
            let next = account
                .quoted_fill(u8::from(delta < 0), delta.unsigned_abs(), gross, funding)
                .unwrap();
            EntryCost::read(&slot, account.lots)
                .unwrap()
                .fill(account.lots, next.lots, gross)
                .unwrap()
                .write(&mut slot)
                .unwrap();
            account = next;
        }
        let lots = account.lots;
        let claim = account.unpaid(mark, funding).unwrap();
        let cost = EntryCost::read(&slot, lots).unwrap();
        let ordinary = cost.ordinary_cap(lots, mark, claim).unwrap();
        let forced = cost
            .frozen_basis(lots)
            .unwrap()
            .charge_cap(lots, mark, claim, matched)
            .unwrap();
        let lower = u128::from_le_bytes(slot[..16].try_into().unwrap());
        let upper = u128::from_le_bytes(slot[16..32].try_into().unwrap());
        let reference = u64::from_le_bytes(slot[32..].try_into().unwrap());
        println!("{lots} {claim} {ordinary} {forced} {lower} {upper} {reference}");
    }
}

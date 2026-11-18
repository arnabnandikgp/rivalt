//! Local operator transport, not a financial oracle. Reads public RPC account
//! bytes and returns only next page descriptors; the deployed program derives and
//! authenticates them again. Independent Python expectations check actual money.
use anchor_lang::AccountDeserialize;
use clearing::{
    instructions::account_safety::settlement::{settlement_plan_pages, settlement_plan_row_pages},
    state::accounts::{PreparedSettlement, SettlementPlan, SettlementRates},
};
use std::io::{self, Read};
fn bytes(text: &str) -> Vec<u8> {
    assert!(text.len() % 2 == 0);
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let fields: Vec<_> = input.trim().split('|').collect();
    assert_eq!(fields.len(), 4);
    let header = PreparedSettlement::try_deserialize(&mut bytes(fields[0]).as_slice()).unwrap();
    let rates = SettlementRates::try_deserialize(&mut bytes(fields[1]).as_slice()).unwrap();
    let plan = SettlementPlan::try_deserialize(&mut bytes(fields[2]).as_slice()).unwrap();
    let pages = if fields[3] == "work" {
        settlement_plan_pages(&header, &rates, &plan)
    } else {
        settlement_plan_row_pages(&header, &rates, &plan, fields[3].parse().unwrap())
    }
    .unwrap();
    for page in pages.requests() {
        println!(
            "{},{},{}",
            page.register,
            page.index,
            u8::from(page.writable)
        );
    }
}

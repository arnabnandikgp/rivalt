//! Test-only adapter for independently generated admitted-price tables.
use financial_core::liquidity::{best_sample_pair, SAMPLE_ENTRIES, SAMPLE_STRIDE};
use std::io::{self, BufRead};

fn evaluate(line: &str) -> Result<String, String> {
    let values = line
        .split_whitespace()
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "integer")?;
    if values.len() < 2 {
        return Err("header".into());
    }
    let quantity = values[0];
    if !(1..=600).contains(&quantity) || values[1] > 1 || values.len() != 2 + 3 * quantity as usize
    {
        return Err("shape".into());
    }
    let mut table = vec![0; SAMPLE_ENTRIES];
    for maker in 0..3 {
        for lots in 1..=quantity as usize {
            table[maker * SAMPLE_STRIDE + lots] = values[2 + maker * quantity as usize + lots - 1];
        }
    }
    match best_sample_pair(&table, quantity, values[1] as u8)
        .map_err(|error| format!("{error:?}"))?
    {
        Some(best) => Ok(format!(
            "OK {} {} {} {}",
            best.gross, best.quantities[0], best.quantities[1], best.quantities[2]
        )),
        None => Ok("NONE".into()),
    }
}

fn main() {
    for line in io::stdin().lock().lines() {
        match evaluate(&line.expect("read vector")) {
            Ok(answer) => println!("{answer}"),
            Err(reason) => println!("ERR {reason}"),
        }
    }
}

//! Native parity driver. Calls the actual canonical implementation; expectations
//! are produced independently by tests/financial/check_maker_curve_parity.py.
use anchor_lang::AnchorDeserialize;
use maker_interface::canonical::{quote_amount, ShapeV4};
use std::io::{self, BufRead};

fn decode_hex(input: &str) -> Result<Vec<u8>, String> {
    if input.len() % 2 != 0 || !input.is_ascii() {
        return Err("hex".into());
    }
    (0..input.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&input[index..index + 2], 16).map_err(|_| "hex".into()))
        .collect()
}

fn evaluate(line: &str) -> Result<(u64, u64), String> {
    let fields: Vec<_> = line.split_whitespace().collect();
    if fields.len() != 6 {
        return Err("fields".into());
    }
    let shape = ShapeV4::try_from_slice(&decode_hex(fields[0])?).map_err(|_| "shape")?;
    quote_amount(
        &shape,
        fields[1].parse().map_err(|_| "anchor")?,
        fields[2].parse().map_err(|_| "side")?,
        fields[3].parse().map_err(|_| "lots")?,
        fields[4].parse().map_err(|_| "inventory")?,
        fields[5].parse().map_err(|_| "consumed")?,
    )
    .map_err(|error| format!("{error:?}"))
}

fn main() {
    for line in io::stdin().lock().lines() {
        match evaluate(&line.expect("read vector")) {
            Ok((gross, remaining)) => println!("OK {gross} {remaining}"),
            Err(reason) => println!("ERR {reason}"),
        }
    }
}

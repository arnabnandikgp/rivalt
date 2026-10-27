//! Test transport for independent Python vectors against the real Rust arithmetic.
use financial_core::clearing::wide::{self, LIMBS};
mod clearing_support;
use clearing_support::{format, parse, small};
use financial_core::{Error, Result};
use std::io::{self, BufRead};

fn execute(line: &str) -> Result<String> {
    let arguments: Vec<_> = line.split_whitespace().collect();
    if arguments.len() != 3 {
        return Err(Error::Bounds);
    }
    let value = parse(arguments[1])?;
    let operand = parse(arguments[2])?;
    let mut output = [0; LIMBS];
    match arguments[0] {
        "add" => {
            output = value;
            wide::add_assign(&mut output, &operand)?;
        }
        "sub" => {
            output = value;
            wide::subtract_assign(&mut output, &operand)?;
        }
        "mul" => {
            if wide::bits(&operand) > 192 {
                return Err(Error::Bounds);
            }
            wide::multiply(&mut output, &value, &operand[..3])?;
        }
        "div-small" => {
            let remainder = wide::divide_small(&mut output, &value, small(arguments[2])?)?;
            return Ok(format!("{} {remainder:x}", format(&output)));
        }
        "div-atoms" => {
            let quotient = wide::divide_atoms(&mut output, &value, &operand)?;
            return Ok(format!("{quotient:x} {}", format(&output)));
        }
        "product-small" => {
            let result = wide::product_small(small(arguments[1])?, small(arguments[2])?)?;
            output[..3].copy_from_slice(&result);
        }
        _ => return Err(Error::Bounds),
    }
    Ok(format(&output))
}
fn main() {
    for line in io::stdin().lock().lines() {
        match line
            .map_err(|_| Error::Bounds)
            .and_then(|line| execute(&line))
        {
            Ok(result) => println!("{result}"),
            Err(error) => println!("err:{error:?}"),
        }
    }
}

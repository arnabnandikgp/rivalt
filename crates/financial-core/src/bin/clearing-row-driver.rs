//! Test transport for complete input/row/rate primitives, not an on-chain keeper.
mod clearing_support;
use clearing_support::{format, parse};
use financial_core::clearing::{
    row::{self, Row},
    wide::{self, LIMBS},
};
use financial_core::{Error, Result, MAX_CASH, SCALE};
use std::io::{self, BufRead};

fn decimal<T: std::str::FromStr>(value: &str) -> Result<T> {
    value.parse().map_err(|_| Error::Bounds)
}
fn pair(value: &str) -> Result<[u64; 2]> {
    let values = value.split(',').map(decimal).collect::<Result<Vec<_>>>()?;
    values.try_into().map_err(|_| Error::Bounds)
}
fn execute(line: &str) -> Result<String> {
    let fields: Vec<_> = line.split('|').collect();
    if fields.len() != 4 {
        return Err(Error::Bounds);
    }
    let rows = fields[0]
        .split(';')
        .map(|text| {
            let values: Vec<_> = text.split(',').collect();
            if values.len() != 3 {
                return Err(Error::Bounds);
            }
            Ok(Row {
                cash: decimal(values[0])?,
                claims: [decimal(values[1])?, decimal(values[2])?],
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if rows.is_empty() || rows.len() > 64 {
        return Err(Error::Bounds);
    }
    let pools = pair(fields[1])?;
    let budgets = pair(fields[2])?;
    let proposal: Vec<_> = fields[3].split(',').collect();
    if proposal.len() != 3 {
        return Err(Error::Bounds);
    }
    let rates = [parse(proposal[0])?, parse(proposal[1])?];
    let factor_words = parse(proposal[2])?;
    if wide::bits(&factor_words) == 0 || wide::bits(&factor_words) > 186 {
        return Err(Error::Bounds);
    }
    let factor = [factor_words[0], factor_words[1], factor_words[2]];
    let mut common = [0; LIMBS];
    common[0] = 1;
    let mut positives = [0u128; 2];
    let mut sums = [0i128; 2];
    let mut allocated = 0u128;
    for row in &rows {
        row.denominator(&mut common)?;
        allocated += u128::from(row.cash);
        for index in 0..2 {
            sums[index] += row.claims[index];
            positives[index] += row.claims[index].max(0) as u128;
        }
    }
    for index in 0..2 {
        if pools[index] > MAX_CASH
            || budgets[index] > MAX_CASH
            || sums[index] != i128::from(pools[index]) * SCALE
        {
            return Err(Error::Invariant);
        }
        allocated += u128::from(pools[index]) + u128::from(budgets[index]);
    }
    if allocated > u128::from(MAX_CASH) {
        return Err(Error::Bounds);
    }
    let mut denominator = [0; LIMBS];
    wide::multiply(&mut denominator, &common, &factor)?;
    let mut cash_denominator = [0; LIMBS];
    wide::multiply(&mut cash_denominator, &denominator, &[SCALE as u64])?;
    let mut incoming = [[0; LIMBS]; 2];
    let mut slopes = [0u128; 2];
    let mut scratch = [0; LIMBS];
    let mut cap = [0; LIMBS];
    let mut flows = Vec::new();
    for row in &rows {
        let mut output = [[0; LIMBS]; 2];
        for index in 0..2 {
            row.flow(
                index,
                &common,
                &factor,
                [&rates[0], &rates[1]],
                &denominator,
                &mut output[index],
                &mut scratch,
            )?;
            if row.claims[index] < 0 {
                wide::add_assign(&mut incoming[index], &output[index])?;
            }
            slopes[index] += row.right_slope(
                index,
                &rates[1 - index],
                &denominator,
                &mut scratch,
                &mut cap,
            )?;
        }
        flows.push(format!(
            "{}{},{}{}",
            if row.claims[0] < 0 { "-" } else { "" },
            format(&output[0]),
            if row.claims[1] < 0 { "-" } else { "" },
            format(&output[1])
        ));
    }
    let mut spent = [0; 2];
    let mut fractional = 0u8;
    let mut remainder = [0; LIMBS];
    for index in 0..2 {
        let result = row::verify_market(
            positives[index],
            pools[index],
            budgets[index],
            &rates[index],
            &denominator,
            &cash_denominator,
            &incoming[index],
            &mut scratch,
            &mut cap,
            &mut remainder,
        )?;
        spent[index] = result.0;
        fractional |= u8::from(result.1) << index;
    }
    row::greatest([&rates[0], &rates[1]], &denominator, slopes, positives)?;
    Ok(format!(
        "{}|{}|{},{}|{}|{},{}|{}",
        format(&common),
        format(&cash_denominator),
        spent[0],
        spent[1],
        fractional,
        slopes[0],
        slopes[1],
        flows.join(";")
    ))
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

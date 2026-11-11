//! Native transport for independent P55B arithmetic checks. The driver's row
//! indices model authenticated coverage; they provide no runtime authority.
use financial_core::{backing::{Contribution, MarketRegion, Region, Summary},
    margin::{Margin, Mode, Position}, Error, Result};
use std::{io::{self, BufRead}, str::FromStr};

fn scalar<T: FromStr>(value: &str) -> Result<T> { value.parse().map_err(|_| Error::Bounds) }
fn region(value: &str) -> Result<Region> {
    let values: Vec<_> = value.split(',').collect();
    if values.len() != 8 { return Err(Error::Bounds); }
    let market = |start| -> Result<MarketRegion> { Ok(MarketRegion {
        price_low: scalar(values[start])?, price_high: scalar(values[start+1])?,
        funding_low: scalar(values[start+2])?, funding_high: scalar(values[start+3])? }) };
    Ok(Region { markets: [market(0)?, market(4)?] })
}
fn root(value: &str) -> Result<Margin> {
    let values: Vec<_> = value.split(',').collect();
    if values.len() != 9 { return Err(Error::Bounds); }
    let position = |start| -> Result<Position> {
        let lots = scalar(values[start])?;
        Ok(Position { lots, virtual_scaled: scalar(values[start+1])?,
            funding_checkpoint: scalar(values[start+2])?, generation: u64::from(lots != 0) }) };
    Ok(Margin { id: 0, mode: match values[8] {
        "0" => Mode::Isolated(0), "1" => Mode::Isolated(1), "2" => Mode::Cross, _ => return Err(Error::Bounds),
    }, cash: scalar(values[0])?, positions: [position(1)?, position(4)?], reserved: scalar(values[7])? })
}
fn contribution(value: &str) -> Result<Contribution> {
    let values: Vec<_> = value.split(',').collect();
    if values.len() != 4 || !matches!(values[2], "0" | "1") { return Err(Error::Bounds); }
    Ok(Contribution { quantity: scalar(values[0])?, fixed: scalar(values[1])?,
        bad: values[2] == "1", required: scalar(values[3])? })
}
fn hex(bytes: &[u8]) -> String { bytes.iter().map(|byte| format!("{byte:02x}")).collect() }
fn decode_hex(text: &str) -> Result<Vec<u8>> {
    if text.len() % 2 != 0 { return Err(Error::Bounds); }
    text.as_bytes().chunks(2).map(|chunk| u8::from_str_radix(
        std::str::from_utf8(chunk).map_err(|_| Error::Bounds)?, 16).map_err(|_| Error::Bounds)).collect()
}
fn run(line: &str) -> Result<String> {
    let fields: Vec<_> = line.split('|').collect();
    match fields.as_slice() {
        ["contribution", selected, bounds, row] => {
            let value = region(bounds)?.contribution(&root(row)?, scalar(selected)?)?;
            Ok(format!("{},{},{},{}", value.quantity, value.fixed, u8::from(value.bad), value.required))
        },
        ["contains", mask, bounds, prices, funding] => {
            let prices = prices.split(',').map(scalar).collect::<Result<Vec<u64>>>()?;
            let funding = funding.split(',').map(scalar).collect::<Result<Vec<i128>>>()?;
            if prices.len() != 4 || funding.len() != 4 { return Err(Error::Bounds); }
            Ok(u8::from(region(bounds)?.contains(scalar(mask)?,
                [[prices[0], prices[1]], [prices[2], prices[3]]],
                [[funding[0], funding[1]], [funding[2], funding[3]]])?).to_string())
        },
        ["decode", encoded, count, pool] => {
            let summary = Summary::from_checkpoint(&decode_hex(encoded)?)?;
            Ok(format!("{}|{}", hex(&summary.checkpoint()), u8::from(summary.arithmetically_ready(scalar(count)?, scalar(pool)?)?)))
        },
        ["replace", encoded, before, after] => {
            let summary = Summary::from_checkpoint(&decode_hex(encoded)?)?;
            let next = summary.replace(contribution(before)?, contribution(after)?)?;
            Ok(hex(&next.checkpoint()))
        },
        ["sequence", selected, bounds, rows, operations, pool] => {
            let selected = scalar(selected)?;
            let region = region(bounds)?;
            let mut rows = rows.split(';').map(root).collect::<Result<Vec<_>>>()?;
            let mut processed = vec![false; rows.len()];
            let count = u64::try_from(rows.len()).map_err(|_| Error::Bounds)?;
            let pool = scalar(pool)?;
            let mut summary = Summary::default();
            let mut output = Vec::new();
            for operation in operations.split(';') {
                let parts: Vec<_> = operation.split(':').collect();
                if parts.len() < 2 { return Err(Error::Bounds); }
                let index: usize = scalar(parts[1])?;
                let old = rows.get_mut(index).ok_or(Error::Bounds)?;
                match parts.as_slice() {
                    ["scan", _] if !processed[index] => {
                        summary = summary.insert(region.contribution(old, selected)?)?;
                        processed[index] = true;
                    },
                    ["mutate", _, replacement] => {
                        let next = root(replacement)?;
                        let contribution = region.contribution(&next, selected)?;
                        if processed[index] {
                            summary = summary.replace(region.contribution(old, selected)?, contribution)?;
                        }
                        *old = next;
                    },
                    _ => return Err(Error::Cohort),
                }
                // Exercise actual checkpoint restoration at every step.
                summary = Summary::from_checkpoint(&summary.checkpoint())?;
                output.push(format!("{},{}", hex(&summary.checkpoint()),
                    u8::from(summary.arithmetically_ready(count, pool)?)));
            }
            Ok(output.join(";"))
        },
        _ => Err(Error::Bounds),
    }
}
fn main() {
    for line in io::stdin().lock().lines() {
        match line.map_err(|_| Error::Bounds).and_then(|line| run(&line)) {
            Ok(output) => println!("{output}"), Err(error) => println!("err:{error:?}"),
        }
    }
}

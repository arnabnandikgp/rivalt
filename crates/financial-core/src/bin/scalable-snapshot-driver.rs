//! Native transport for independent frozen-total tests. No runtime authority.
use financial_core::clearing::{
    row::Row,
    scalable::snapshot::{ClaimTotal, SnapshotBinding, SnapshotScan},
};
use financial_core::{Error, Result};
use std::{
    fmt::Display,
    io::{self, BufRead},
    str::FromStr,
};
fn scalar<T: FromStr>(value: &str) -> Result<T> {
    value.parse().map_err(|_| Error::Bounds)
}
fn pair<T: FromStr>(value: &str) -> Result<[T; 2]> {
    let mut parts = value.split(',');
    let result = [
        scalar(parts.next().ok_or(Error::Bounds)?)?,
        scalar(parts.next().ok_or(Error::Bounds)?)?,
    ];
    if parts.next().is_some() {
        return Err(Error::Bounds);
    }
    Ok(result)
}
fn total(text: &str) -> Result<ClaimTotal> {
    let mut words = [0u64; 3];
    if text.is_empty() || text.len() > 48 {
        return Err(Error::Bounds);
    }
    for (index, chunk) in text.as_bytes().rchunks(16).enumerate() {
        words[index] =
            u64::from_str_radix(std::str::from_utf8(chunk).map_err(|_| Error::Bounds)?, 16)
                .map_err(|_| Error::Bounds)?;
    }
    ClaimTotal::from_words(words)
}
fn join<T: Display>(values: impl IntoIterator<Item = T>) -> String {
    values
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",")
}
fn run(line: &str) -> Result<String> {
    let fields: Vec<_> = line.split('|').collect();
    if fields.len() == 3 && fields[0] == "total" {
        return Ok(total(fields[1])?
            .add(total(fields[2])?)?
            .words()
            .iter()
            .rev()
            .map(|word| format!("{word:016x}"))
            .collect());
    }
    if fields.len() != 8 || fields[0] != "snapshot" {
        return Err(Error::Bounds);
    }
    let binding = SnapshotBinding {
        allocated: scalar(fields[1])?,
        pools: pair(fields[2])?,
        insurance: pair(fields[3])?,
        fees: pair(fields[4])?,
        gross: pair(fields[5])?,
        count: scalar(fields[6])?,
    };
    let mut scan = SnapshotScan::new(binding)?;
    let mut prefixes = Vec::new();
    for (ordinal, encoded) in fields[7].split(';').enumerate() {
        let values: Vec<_> = encoded.split(',').collect();
        if values.len() != 6 {
            return Err(Error::Bounds);
        }
        if scan.result().is_ok() {
            return Err(Error::Invariant);
        }
        let before = scan.checkpoint();
        if let Err(error) = scan.accept(
            ordinal as u64,
            scalar(values[0])?,
            &Row {
                cash: scalar(values[1])?,
                claims: [scalar(values[2])?, scalar(values[3])?],
            },
            [scalar(values[4])?, scalar(values[5])?],
        ) {
            if scan.checkpoint() != before {
                return Err(Error::Invariant);
            }
            return Err(error);
        }
        let bytes = scan.checkpoint();
        scan = SnapshotScan::from_checkpoint(&bytes, binding)?;
        prefixes.push(
            bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
        );
    }
    let result = scan.result()?;
    if scan.next().is_ok()
        || scan
            .accept(binding.count, u64::MAX, &Row::default(), [0; 2])
            .is_ok()
    {
        return Err(Error::Invariant);
    }
    Ok(format!(
        "{}|{}|{}|{}",
        result.cash,
        join(result.positive.into_iter().flat_map(ClaimTotal::words)),
        join(result.negative.into_iter().flat_map(ClaimTotal::words)),
        prefixes.join(";")
    ))
}
fn main() {
    for line in io::stdin().lock().lines() {
        match line.map_err(|_| Error::Bounds).and_then(|line| run(&line)) {
            Ok(output) => println!("{output}"),
            Err(error) => println!("err:{error:?}"),
        }
    }
}

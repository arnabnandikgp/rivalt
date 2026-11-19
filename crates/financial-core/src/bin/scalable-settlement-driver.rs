//! Native test transport. No account authentication or program entrypoint.
use financial_core::{
    clearing::{
        row::Row,
        scalable::{
            number::{Arithmetic, Number},
            rounding::Circulation,
            settlement::{verify, verify_reduced_claims, Proposal},
            wide::required_limbs,
        },
    },
    Error, Result,
};
use std::io::{self, BufRead};

fn decimal<T: std::str::FromStr>(value: &str) -> Result<T> {
    value.parse().map_err(|_| Error::Bounds)
}
fn pair(value: &str) -> Result<[u64; 2]> {
    value
        .split(',')
        .map(decimal)
        .collect::<Result<Vec<_>>>()?
        .try_into()
        .map_err(|_| Error::Bounds)
}
fn parse(value: &str, capacity: u64) -> Result<Number> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
        || value.len().div_ceil(16) as u64 > capacity
    {
        return Err(Error::Bounds);
    }
    let words = value
        .as_bytes()
        .rchunks(16)
        .map(|chunk| {
            u64::from_str_radix(std::str::from_utf8(chunk).map_err(|_| Error::Bounds)?, 16)
                .map_err(|_| Error::Bounds)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Number::from_words(words))
}
fn hex(value: &Number) -> String {
    if value.is_zero() {
        return "0".into();
    }
    value
        .words()
        .iter()
        .rev()
        .map(|word| format!("{word:016x}"))
        .collect()
}
fn decimals(values: impl IntoIterator<Item = u64>) -> String {
    values
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",")
}
fn parse_rows(value: &str) -> Result<Vec<Row>> {
    value
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
        .collect()
}
fn parse_proposals(text: &str, capacity: u64) -> Result<Vec<Proposal>> {
    text.split(';')
        .map(|text| {
            let values: Vec<_> = text.split(',').collect();
            if values.len() != 3 {
                return Err(Error::Bounds);
            }
            Ok(Proposal {
                factor: parse(values[0], 5)?,
                rates: [parse(values[1], capacity)?, parse(values[2], capacity)?],
            })
        })
        .collect()
}
fn order(text: &str) -> Result<Vec<u64>> {
    text.split(',').map(decimal).collect()
}
fn execute(line: &str) -> Result<String> {
    let fields: Vec<_> = line.split('|').collect();
    if fields.len() == 5 && ["atoms", "product"].contains(&fields[0]) {
        let capacity = decimal(fields[1])?;
        let mut arithmetic = Arithmetic::new(capacity, decimal(fields[4])?)?;
        let numerator = parse(fields[2], capacity)?;
        let denominator = parse(fields[3], capacity)?;
        if fields[0] == "product" {
            return Ok(hex(&arithmetic.multiply(&numerator, &denominator)?));
        }
        let (quotient, remainder) = arithmetic.divide_atoms(&numerator, &denominator)?;
        return Ok(format!(
            "{quotient}|{}|{}",
            hex(&remainder),
            arithmetic.steps
        ));
    }
    let protected = fields[0] == "protected";
    let reduced = fields[0] == "reduced" || protected;
    let expected_fields = match fields[0] {
        "full" | "compact" | "paged" => 9,
        "reduced" => 10,
        "protected" => 13,
        _ => return Err(Error::Bounds),
    };
    if fields.len() != expected_fields {
        return Err(Error::Bounds);
    }
    let rows = parse_rows(fields[1])?;
    let capacity = required_limbs(u64::try_from(rows.len()).map_err(|_| Error::Bounds)?)?;
    let budget: u64 = decimal(fields[8])?;
    let mut arithmetic = Arithmetic::new(capacity, budget)?;
    let proposals = parse_proposals(fields[5], capacity)?;
    let original = if reduced {
        parse_rows(fields[9])?
    } else {
        Vec::new()
    };
    let pools = pair(fields[2])?;
    let insurance = pair(fields[3])?;
    let fees = pair(fields[4])?;
    let plan = if reduced {
        verify_reduced_claims(
            &original,
            &rows,
            pools,
            insurance,
            fees,
            &proposals,
            &mut arithmetic,
        )?
    } else {
        verify(&rows, pools, insurance, fees, &proposals, &mut arithmetic)?
    };
    let (first, second) = (order(fields[6])?, order(fields[7])?);
    let orders = [&first[..], &second[..]];
    let mut graph = if protected {
        let original_plan = verify(
            &original,
            pools,
            insurance,
            fees,
            &parse_proposals(fields[10], capacity)?,
            &mut arithmetic,
        )?;
        let (btc, eth) = (order(fields[11])?, order(fields[12])?);
        let mut baseline = Circulation::new(&original_plan, [&btc, &eth], &mut arithmetic)?;
        while !baseline.is_done() {
            baseline.step()?;
        }
        Circulation::after_reduction(&plan, &baseline, orders, &mut arithmetic)?
    } else {
        Circulation::new(&plan, orders, &mut arithmetic)?
    };
    let paged = if fields[0] == "paged" || protected {
        Some(graph.run_paged(budget, [&first, &second], &mut arithmetic)?)
    } else {
        None
    };
    if graph.result().is_ok() {
        return Err(Error::Invariant);
    }
    let mut continuations = 0u64;
    while !graph.is_done() {
        for _ in 0..budget {
            if graph.is_done() {
                break;
            }
            graph.step()?;
        }
        continuations += 1;
        // Copy at three different early suspension points, including budgets of
        // one transition. Avoid an O(N) host snapshot after every graph step.
        if continuations <= 3 {
            graph = graph.clone();
        }
        if !graph.is_done() && graph.result().is_ok() {
            return Err(Error::Invariant);
        }
    }
    if graph.step().is_ok() {
        return Err(Error::Invariant);
    }
    let mut result = graph.result()?;
    let paged_metrics = paged.as_ref().map(|value| {
        format!(
            "{},{},{},{},{},{},{}",
            value.steps,
            value.reads,
            value.writes,
            value.augmentations,
            value.build_metrics[0],
            value.build_metrics[1],
            value.build_metrics[2]
        )
    });
    if let Some(paged) = paged {
        if result.cash != paged.rounded.cash
            || result.movements != paged.rounded.movements
            || graph.augmentations != paged.augmentations
        {
            return Err(Error::Invariant);
        }
        result = paged.rounded;
    }
    let movements = result
        .movements
        .iter()
        .map(|row| format!("{},{}", row[0], row[1]))
        .collect::<Vec<_>>()
        .join(";");
    let mut attribution = Vec::new();
    if ["full", "paged", "reduced", "protected"].contains(&fields[0]) {
        for index in 0..rows.len() {
            let row = plan.attribution(index, &mut arithmetic)?;
            attribution.push(
                row.flows
                    .iter()
                    .chain(&row.collections)
                    .chain(&row.residuals)
                    .chain(&row.impairments)
                    .map(hex)
                    .collect::<Vec<_>>()
                    .join(","),
            );
        }
    }
    let mut output = format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{},{},{},{},{},{},{},{},{}|{}|{}",
        hex(plan.common()),
        hex(plan.denominator()),
        decimals(plan.insurance_spent()),
        decimals(plan.effective_budgets()),
        plan.evaluations(),
        decimals(result.cash),
        movements,
        plan.market_residuals()
            .iter()
            .map(hex)
            .collect::<Vec<_>>()
            .join(","),
        plan.market_losses()
            .iter()
            .map(hex)
            .collect::<Vec<_>>()
            .join(","),
        attribution.join(";"),
        arithmetic.steps,
        arithmetic.comparisons,
        arithmetic.largest_words,
        graph.steps,
        graph.arc_visits,
        graph.augmentations,
        graph.active_reads(),
        graph.active_writes(),
        graph.payload_bytes(),
        decimals(result.remaining_insurance),
        decimals(result.retained_fees)
    );
    if let Some(metrics) = paged_metrics {
        output.push('|');
        output.push_str(&metrics);
    }
    Ok(output)
}
fn main() {
    for line in io::stdin().lock().lines() {
        match line
            .map_err(|_| Error::Bounds)
            .and_then(|line| execute(&line))
        {
            Ok(value) => println!("{value}"),
            Err(error) => println!("err:{error:?}"),
        }
    }
}

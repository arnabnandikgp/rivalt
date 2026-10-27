//! Test-only fixed-storage circulation transport. Financial inputs are supplied
//! by an independent benchmark; this is not an operational payout proposer.
mod clearing_support;
use clearing_support::parse;
use financial_core::clearing::{
    atoms,
    circulation::{Graph, MAX_ARCS, MAX_NODES},
    row::Row,
    wide::{self, Wide, LIMBS},
};
use financial_core::{Error, Result};
use std::{
    cmp::Ordering,
    io::{self, BufRead},
};
fn number<T: std::str::FromStr>(text: &str) -> Result<T> {
    text.parse().map_err(|_| Error::Bounds)
}
fn execute(line: &str) -> Result<String> {
    let fields: Vec<_> = line.split('|').collect();
    if fields.len() != 4 {
        return Err(Error::Bounds);
    }
    let mut inputs = Vec::new();
    for text in fields[0].split(';') {
        let values: Vec<_> = text.split(',').collect();
        if values.len() != 5 {
            return Err(Error::Bounds);
        }
        inputs.push((
            Row {
                cash: number(values[0])?,
                claims: [number(values[1])?, number(values[2])?],
            },
            [parse(values[3])?, parse(values[4])?],
        ));
    }
    let count = inputs.len();
    if count == 0 || count > 64 {
        return Err(Error::Bounds);
    }
    let pools = fields[1]
        .split(',')
        .map(number)
        .collect::<Result<Vec<u64>>>()?;
    if pools.len() != 2 {
        return Err(Error::Bounds);
    }
    let denominator = parse(fields[2])?;
    let budget: u16 = number(fields[3])?;
    let mut signs = [0; 4];
    let mut root_orders = [0; LIMBS];
    let mut balances = [0; LIMBS];
    let mut market_orders = [[0; 64]; 2];
    let mut capacities = [0; MAX_ARCS];
    let mut parent = [0; MAX_NODES];
    let mut next = [0; MAX_NODES];
    let mut path = [0; MAX_NODES];
    let (mut depth, mut augmentations, mut sent) = (0, 0, 0);
    let mut market_balances = pools
        .iter()
        .map(|value| i128::from(*value))
        .collect::<Vec<_>>();
    let mut sink_balance = -(inputs
        .iter()
        .map(|(row, _)| i128::from(row.cash))
        .sum::<i128>()
        + pools.iter().map(|value| i128::from(*value)).sum::<i128>());
    let mut plans = Vec::new();
    let mut remainders: Vec<[Wide; 2]> = Vec::new();
    for (id, (row, flows)) in inputs.iter().enumerate() {
        let mut scratch = [[0; LIMBS]; 4];
        let plan = atoms::plan(row, flows.each_ref(), &denominator, scratch.each_mut())?;
        root_orders[id] = plan.root_order;
        balances[id] = plan.residual as u64;
        let mut market_remainders = [[0; LIMBS]; 2];
        for market in 0..2 {
            if row.claims[market] != 0 {
                signs[market * 2 + usize::from(row.claims[market] < 0)] |= 1u64 << id;
            }
            capacities[2 * (market * count + id)] = u16::from(plan.fractional[market]);
            market_balances[market] -= row.claims[market].signum() * i128::from(plan.flows[market]);
            if row.claims[market] > 0 {
                market_remainders[market] = scratch[market];
            }
        }
        capacities[2 * (2 * count + id)] = u16::from(plan.fractional[2]);
        sink_balance += i128::from(plan.cash);
        plans.push(plan);
        remainders.push(market_remainders);
    }
    for market in 0..2 {
        balances[count + market] =
            i64::try_from(market_balances[market]).map_err(|_| Error::Bounds)? as u64;
        let mut order = (0..count).collect::<Vec<_>>();
        order.sort_by(|left, right| {
            match wide::compare(&remainders[*right][market], &remainders[*left][market]) {
                Ordering::Equal => left.cmp(right),
                comparison => comparison,
            }
        });
        for (index, row) in order.into_iter().enumerate() {
            market_orders[market][index] = row as u16;
        }
    }
    balances[count + 2] = i64::try_from(sink_balance).map_err(|_| Error::Bounds)? as u64;
    let mut graph = Graph {
        count,
        signs,
        root_orders: &root_orders,
        balances: &balances,
        market_orders: &market_orders,
        capacities: &mut capacities,
        parents: &mut parent,
        next: &mut next,
        path: &mut path,
        depth: &mut depth,
        augmentations: &mut augmentations,
        sent: &mut sent,
    };
    graph.initialize()?;
    let mut calls = 0;
    loop {
        calls += 1;
        if graph.step(budget)? {
            break;
        }
        if calls > 200_000 {
            return Err(Error::Bounds);
        }
    }
    graph.audit()?;
    let mut cash = Vec::new();
    let mut flows = Vec::new();
    for (id, plan) in plans.iter().enumerate() {
        cash.push((plan.cash + u64::from(capacities[2 * (2 * count + id) + 1])).to_string());
        flows.push(
            (0..2)
                .map(|market| {
                    (i128::from(
                        plan.flows[market] + u64::from(capacities[2 * (market * count + id) + 1]),
                    ) * inputs[id].0.claims[market].signum())
                    .to_string()
                })
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    Ok(format!(
        "{}|{}|{}|{}",
        cash.join(","),
        flows.join(";"),
        augmentations,
        calls
    ))
}
fn main() {
    for line in io::stdin().lock().lines() {
        match line
            .map_err(|_| Error::Bounds)
            .and_then(|line| execute(&line))
        {
            Ok(output) => println!("{output}"),
            Err(error) => println!("err:{error:?}"),
        }
    }
}

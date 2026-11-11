//! Independent-test transport for the actual bounded complete-rate schedule.
use financial_core::{
    clearing::{
        row::Row,
        scalable::{
            flow_work::FlowWork,
            normalized::Magnitude,
            pages::PagePlan,
            rate_work::{RateInput, RateWork},
            snapshot::ClaimTotal,
            wide::{required_limbs, LimbStorage, WordAccess},
        },
    },
    Error, Result,
};
use std::io::{self, BufRead};
struct Store {
    words: Vec<Vec<u64>>,
    allowed: [Option<WordAccess>; 3],
    accesses: std::cell::Cell<u64>,
}
impl LimbStorage for Store {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        if !self
            .allowed
            .iter()
            .flatten()
            .any(|access| access.register == register && access.limb == limb)
        {
            return Err(Error::Invariant);
        }
        if !PagePlan::next(self.allowed, self.words[0].len() as u64)?.permits(register, limb, false)
        {
            return Err(Error::Invariant);
        }
        self.accesses.set(self.accesses.get() + 1);
        self.words
            .get(register as usize)
            .and_then(|words| words.get(limb as usize))
            .copied()
            .ok_or(Error::Bounds)
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        if !self
            .allowed
            .iter()
            .flatten()
            .any(|access| access.register == register && access.limb == limb && access.writable)
        {
            return Err(Error::Invariant);
        }
        if !PagePlan::next(self.allowed, self.words[0].len() as u64)?.permits(register, limb, true)
        {
            return Err(Error::Invariant);
        }
        self.accesses.set(self.accesses.get() + 1);
        *self
            .words
            .get_mut(register as usize)
            .and_then(|words| words.get_mut(limb as usize))
            .ok_or(Error::Bounds)? = value;
        Ok(())
    }
}
fn decimal<T: std::str::FromStr>(text: &str) -> Result<T> {
    text.parse().map_err(|_| Error::Bounds)
}
fn pair(text: &str) -> Result<[u64; 2]> {
    text.split(',')
        .map(decimal)
        .collect::<Result<Vec<_>>>()?
        .try_into()
        .map_err(|_| Error::Bounds)
}
fn parse(text: &str, capacity: u64) -> Result<Vec<u64>> {
    if text.is_empty()
        || !text.bytes().all(|byte| byte.is_ascii_hexdigit())
        || text.len().div_ceil(16) as u64 > capacity
    {
        return Err(Error::Bounds);
    }
    let mut words = text
        .as_bytes()
        .rchunks(16)
        .map(|chunk| {
            u64::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).map_err(|_| Error::Bounds)
        })
        .collect::<Result<Vec<_>>>()?;
    while words.last() == Some(&0) {
        words.pop();
    }
    Ok(words)
}
fn hex(store: &Store, value: Magnitude) -> String {
    if value.used == 0 {
        return "0".into();
    }
    store.words[value.register as usize][..value.used as usize]
        .iter()
        .rev()
        .map(|word| format!("{word:016x}"))
        .collect()
}
fn execute(text: &str) -> Result<String> {
    let fields: Vec<_> = text.split('|').collect();
    if fields.len() != 7 || !["rates", "flows"].contains(&fields[0]) {
        return Err(Error::Bounds);
    }
    let rows = fields[1]
        .split(';')
        .map(|text| {
            let row: Vec<_> = text.split(',').collect();
            if row.len() != 3 {
                return Err(Error::Bounds);
            }
            Ok(Row {
                cash: decimal(row[0])?,
                claims: [decimal(row[1])?, decimal(row[2])?],
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let capacity = required_limbs(rows.len() as u64)?;
    let pools = pair(fields[2])?;
    let budgets = pair(fields[3])?;
    let proposal: Vec<_> = fields[5].split(',').collect();
    if proposal.len() != 3 {
        return Err(Error::Bounds);
    }
    let common = parse(fields[4], capacity)?;
    let factor = parse(proposal[0], 5)?;
    let rates = [parse(proposal[1], capacity)?, parse(proposal[2], capacity)?];
    let budget: u64 = decimal(fields[6])?;
    if budget == 0 {
        return Err(Error::Bounds);
    }
    let mut positive = [ClaimTotal::default(); 2];
    let mut negative = positive;
    for row in &rows {
        row.validate()?;
        for market in 0..2 {
            let claim = row.claims[market].unsigned_abs();
            let value = ClaimTotal::from_words([claim as u64, (claim >> 64) as u64, 0])?;
            let target = if row.claims[market] >= 0 {
                &mut positive
            } else {
                &mut negative
            };
            target[market] = target[market].add(value)?;
        }
    }
    let mut factor_words = [0; 5];
    factor_words[..factor.len()].copy_from_slice(&factor);
    let input = RateInput {
        count: rows.len() as u64,
        common: Magnitude {
            register: 0,
            used: common.len() as u64,
        },
        rate_lengths: rates.each_ref().map(|rate| rate.len() as u64),
        factor: factor_words,
        positive,
        negative,
        pools,
        budgets,
    };
    let mut store = Store {
        words: vec![vec![u64::MAX; capacity as usize]; if fields[0] == "flows" { 41 } else { 25 }],
        allowed: [None; 3],
        accesses: std::cell::Cell::new(0),
    };
    store.words[0][..common.len()].copy_from_slice(&common);
    for market in 0..2 {
        store.words[3 + market][..rates[market].len()].copy_from_slice(&rates[market]);
    }
    let mut work = RateWork::new(input)?;
    let mut next = 0;
    let mut steps = 0u64;
    let mut recorded = 0;
    let mut prefixes = Vec::new();
    loop {
        let bytes = work.checkpoint();
        let processed = u64::from_le_bytes(bytes[216..224].try_into().unwrap());
        if processed > recorded {
            if processed != recorded + 1 {
                return Err(Error::Invariant);
            }
            let values = (0..2)
                .map(|market| {
                    let register = if bytes[4] & (1 << market) == 0 {
                        7 + market
                    } else {
                        15 + market
                    };
                    let used = u64::from_le_bytes(
                        bytes[320 + 8 * register..328 + 8 * register]
                            .try_into()
                            .unwrap(),
                    );
                    hex(
                        &store,
                        Magnitude {
                            register: register as u32,
                            used,
                        },
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            prefixes.push(values);
            recorded = processed;
        }
        if work.is_done() {
            break;
        }
        if let Ok(ordinal) = work.row_index() {
            if ordinal as usize != next {
                return Err(Error::Invariant);
            }
            work.accept(ordinal, ordinal * 2, rows[next])?;
            next += 1;
        } else {
            for _ in 0..budget {
                if work.is_done() || work.row_index().is_ok() {
                    break;
                }
                store.allowed = work.accesses()?;
                let before = store.accesses.get();
                work.step(&mut store)?;
                steps += 1;
                if store.accesses.get() - before > 3 {
                    return Err(Error::Invariant);
                }
            }
        }
        work = RateWork::from_checkpoint(&work.checkpoint(), input)?;
    }
    if next != rows.len()
        || work.accept(0, 0, Row::default()).is_ok()
        || work.step(&mut store).is_ok()
    {
        return Err(Error::Invariant);
    }
    if fields[0] == "flows" {
        let binding = work.verified_values()?;
        let mut outcomes = Vec::new();
        for (ordinal, row) in rows.iter().enumerate() {
            let mut flow = FlowWork::new(binding, ordinal as u64, ordinal as u64 * 2, *row)?;
            if flow.result().is_ok() {
                return Err(Error::Invariant);
            }
            let mut flow_steps = 0;
            while !flow.is_done() {
                for _ in 0..budget {
                    if flow.is_done() {
                        break;
                    }
                    store.allowed = flow.accesses()?;
                    let before = store.accesses.get();
                    flow.step(&mut store)?;
                    if store.accesses.get() - before > 3 {
                        return Err(Error::Invariant);
                    }
                    flow_steps += 1;
                }
                flow = FlowWork::from_checkpoint(&flow.checkpoint(), binding)?;
            }
            let result = flow.result()?;
            if flow.step(&mut store).is_ok()
                || flow.identity() != (ordinal as u64, ordinal as u64 * 2)
            {
                return Err(Error::Invariant);
            }
            outcomes.push(format!(
                "{}|{}|{}|{}|{}|{}",
                result.whole.map(|value| value.to_string()).join(","),
                result
                    .fractional
                    .map(|value| u8::from(value).to_string())
                    .join(","),
                result.flows.map(|value| hex(&store, value)).join(","),
                result.remainders.map(|value| hex(&store, value)).join(","),
                result.order.map(|value| value.to_string()).join(","),
                flow_steps
            ));
        }
        return Ok(outcomes.join(";"));
    }
    let result = work.result()?;
    Ok(format!(
        "{},{}|{},{}|{},{}|{},{}|{}|{steps}",
        result.spent[0],
        result.spent[1],
        u8::from(result.fractional[0]),
        u8::from(result.fractional[1]),
        hex(&store, result.residuals[0]),
        hex(&store, result.residuals[1]),
        hex(&store, result.losses[0]),
        hex(&store, result.losses[1]),
        prefixes.join(";")
    ))
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

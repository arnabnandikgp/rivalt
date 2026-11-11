//! Native independent-test transport only; never a program instruction.
use financial_core::clearing::scalable::pages::PagePlan;
use financial_core::clearing::scalable::wide::{required_limbs, Cursor, LimbStorage, Operation};
use financial_core::clearing::{
    row::Row,
    scalable::{collection::ReducedCollection, denominator::LcmCursor},
};
use financial_core::{Error, Result};
use std::io::{self, BufRead};
struct Memory {
    registers: [Vec<u64>; 3],
    reads: std::cell::Cell<u64>,
    writes: u64,
    allowed: Vec<financial_core::clearing::scalable::wide::WordAccess>,
}
impl LimbStorage for Memory {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        if !self
            .allowed
            .iter()
            .any(|access| access.register == register && access.limb == limb)
        {
            return Err(Error::Invariant);
        }
        let accesses = core::array::from_fn(|index| self.allowed.get(index).copied());
        if !PagePlan::next(accesses, self.registers[0].len() as u64)?.permits(register, limb, false)
        {
            return Err(Error::Invariant);
        }
        self.reads.set(self.reads.get() + 1);
        self.registers
            .get(register as usize)
            .and_then(|words| words.get(limb as usize))
            .copied()
            .ok_or(Error::Bounds)
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        if !self
            .allowed
            .iter()
            .any(|access| access.register == register && access.limb == limb && access.writable)
        {
            return Err(Error::Invariant);
        }
        let accesses = core::array::from_fn(|index| self.allowed.get(index).copied());
        if !PagePlan::next(accesses, self.registers[0].len() as u64)?.permits(register, limb, true)
        {
            return Err(Error::Invariant);
        }
        *self
            .registers
            .get_mut(register as usize)
            .and_then(|words| words.get_mut(limb as usize))
            .ok_or(Error::Bounds)? = value;
        self.writes += 1;
        Ok(())
    }
}
fn parse_words(text: &str, width: usize) -> Result<Vec<u64>> {
    let mut words = Vec::new();
    words.try_reserve_exact(width).map_err(|_| Error::Bounds)?;
    words.resize(width, 0);
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(Error::Bounds);
    }
    for (index, chunk) in text.as_bytes().rchunks(16).enumerate() {
        let value = u64::from_str_radix(std::str::from_utf8(chunk).map_err(|_| Error::Bounds)?, 16)
            .map_err(|_| Error::Bounds)?;
        if index >= width {
            if value != 0 {
                return Err(Error::Bounds);
            }
        } else {
            words[index] = value;
        }
    }
    Ok(words)
}
fn execute(text: &str) -> Result<String> {
    let fields: Vec<_> = text.split('|').collect();
    if fields.len() == 2 && fields[0] == "width" {
        return Ok(required_limbs(fields[1].parse().map_err(|_| Error::Bounds)?)?.to_string());
    }
    if fields.len() == 4 && fields[0] == "collection" {
        let row = Row {
            cash: fields[1].parse().map_err(|_| Error::Bounds)?,
            claims: [
                fields[2].parse().map_err(|_| Error::Bounds)?,
                fields[3].parse().map_err(|_| Error::Bounds)?,
            ],
        };
        let reduced = ReducedCollection::for_row(&row)?;
        let encode = |words: [u64; 3]| {
            words
                .iter()
                .rev()
                .map(|word| format!("{word:016x}"))
                .collect::<String>()
        };
        return Ok(format!(
            "{}|{:x}|{}|{}",
            reduced.collected,
            reduced.denominator,
            encode(reduced.numerators[0]),
            encode(reduced.numerators[1])
        ));
    }
    if fields.len() != 5 {
        return Err(Error::Bounds);
    }
    let width: usize = fields[1].parse().map_err(|_| Error::Bounds)?;
    let budget: u64 = fields[2].parse().map_err(|_| Error::Bounds)?;
    if budget == 0 || width == 0 {
        return Err(Error::Bounds);
    }
    let left = parse_words(fields[3], width)?;
    if fields[0] == "cmp" {
        use financial_core::clearing::scalable::comparison::CompareCursor;
        let mut memory = Memory {
            registers: [
                left,
                parse_words(fields[4], width)?,
                parse_words("0", width)?,
            ],
            reads: std::cell::Cell::new(0),
            writes: 0,
            allowed: Vec::new(),
        };
        let mut cursor = CompareCursor::new(width as u64, 0, 1)?;
        let mut steps = 0u64;
        while !cursor.is_done() {
            for _ in 0..budget {
                if cursor.is_done() {
                    break;
                }
                memory.allowed = cursor.accesses()?.into_iter().flatten().collect();
                cursor.step(&memory)?;
                steps += 1;
            }
            cursor = CompareCursor::from_checkpoint(&cursor.checkpoint(), width as u64)?;
        }
        if cursor.step(&memory).is_ok() || memory.writes != 0 || memory.reads.get() != 2 * steps {
            return Err(Error::Invariant);
        }
        let order = match cursor.result()? {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        };
        return Ok(format!("{order}|{steps}"));
    }
    if fields[0] == "lcm" {
        let used = left
            .iter()
            .rposition(|word| *word != 0)
            .map_or(0, |index| index + 1) as u64;
        let divisor = u128::from_str_radix(fields[4], 16).map_err(|_| Error::Bounds)?;
        let mut memory = Memory {
            registers: [left, parse_words("0", width)?, parse_words("0", width)?],
            reads: std::cell::Cell::new(0),
            writes: 0,
            allowed: Vec::new(),
        };
        // Nonzero scratch tails deliberately test clearing before wider reuse.
        memory.registers[1].fill(u64::MAX);
        let mut cursor = LcmCursor::new(used, width as u64, 0, 1, 2, divisor)?;
        let mut steps = 0;
        while !cursor.is_done() {
            for _ in 0..budget {
                if cursor.is_done() {
                    break;
                }
                let before = memory.reads.get() + memory.writes;
                memory.allowed = cursor.accesses()?.into_iter().flatten().collect();
                cursor.step(&mut memory)?;
                steps += 1;
                if memory.reads.get() + memory.writes - before > 3 {
                    return Err(Error::Invariant);
                }
            }
            cursor = LcmCursor::from_checkpoint(&cursor.checkpoint(), width as u64)?;
        }
        if cursor.step(&mut memory).is_ok() {
            return Err(Error::Invariant);
        }
        let encoded = memory.registers[2][..cursor.used()? as usize]
            .iter()
            .rev()
            .map(|word| format!("{word:016x}"))
            .collect::<String>();
        return Ok(format!("{encoded}|{}|{steps}", cursor.used()?));
    }
    let mut right = parse_words("0", width)?;
    let operation = match fields[0] {
        "add" => {
            right = parse_words(fields[4], width)?;
            Operation::Add
        }
        "sub" => {
            right = parse_words(fields[4], width)?;
            Operation::Subtract
        }
        "mul" => {
            let words = parse_words(fields[4], 5)?;
            let mut factor = [0; 5];
            factor.copy_from_slice(&words);
            let length = factor
                .iter()
                .rposition(|word| *word != 0)
                .map_or(1, |index| index + 1) as u8;
            Operation::Multiply { factor, length }
        }
        "div" => Operation::Divide {
            divisor: u128::from_str_radix(fields[4], 16).map_err(|_| Error::Bounds)?,
        },
        _ => return Err(Error::Bounds),
    };
    let mut memory = Memory {
        registers: [left, right, parse_words("0", width)?],
        reads: std::cell::Cell::new(0),
        writes: 0,
        allowed: Vec::new(),
    };
    let mut cursor = Cursor::new(operation, width as u64, 0, 1, 2)?;
    let mut steps = 0u64;
    while !cursor.is_done() {
        for _ in 0..budget {
            if cursor.is_done() {
                break;
            }
            let before = memory.reads.get() + memory.writes;
            memory.allowed = cursor.accesses()?.into_iter().flatten().collect();
            cursor.step(&mut memory)?;
            steps += 1;
            if memory.reads.get() + memory.writes - before > 3 {
                return Err(Error::Invariant);
            }
        }
        // Real byte roundtrip at every budget boundary; authentication and
        // transactional durability remain the program adapter's obligation.
        cursor = Cursor::from_checkpoint(&cursor.checkpoint(), width as u64)?;
    }
    if cursor.step(&mut memory).is_ok() {
        return Err(Error::Invariant);
    }
    let encoded = memory.registers[2]
        .iter()
        .rev()
        .map(|word| format!("{word:016x}"))
        .collect::<String>();
    Ok(format!(
        "{}|{:x}|{steps}|{}|{}",
        encoded.trim_start_matches('0'),
        cursor.remainder().unwrap_or(0),
        memory.reads.get(),
        memory.writes
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

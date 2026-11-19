//! Reads one decimal-string JSON vector per line. All financial work calls the
//! optional native library. The driver has no custody or clearing authority.
use default_plan_selection::multi_lot::{Audit, Book, Member, Verdict};
use num_bigint::BigUint;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{self, BufRead},
    num::NonZeroU32,
};

fn bytes(text: &str) -> Result<Vec<u8>, String> {
    if !text.is_ascii() || text.len() % 2 != 0 {
        return Err("invalid hex".into());
    }
    text.as_bytes()
        .chunks(2)
        .map(|pair| {
            u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16)
                .map_err(|_| "invalid hex".into())
        })
        .collect()
}
fn string(value: &Value) -> Result<&str, String> {
    value
        .as_str()
        .ok_or_else(|| "decimal string or hex required".into())
}
fn number<T: std::str::FromStr>(value: &Value) -> Result<T, String> {
    string(value)?
        .parse()
        .map_err(|_| "unreadable scalar".into())
}
fn array(value: &Value) -> Result<&[Value], String> {
    value
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| "array required".into())
}
fn digest(value: &Value) -> Result<[u8; 32], String> {
    bytes(string(value)?)?
        .try_into()
        .map_err(|_| "32 bytes required".into())
}
fn run(input: Value) -> Result<Value, String> {
    let venue = digest(&input["venue"])?;
    let freeze = digest(&input["freeze"])?;
    let rows = array(&input["rows"])?;
    let histories = rows
        .iter()
        .map(|row| bytes(string(&row["history"])?))
        .collect::<Result<Vec<_>, _>>()?;
    let members = rows
        .iter()
        .zip(&histories)
        .map(|(row, history)| {
            Ok(Member {
                id: number(&row["id"])?,
                lots: number(&row["lots"])?,
                face_scaled: number(&row["claim"])?,
                cash: number(&row["cash"])?,
                history,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let book = Book::from_members(
        &venue,
        number(&input["epoch"])?,
        &freeze,
        number(&input["mark"])?,
        number(&input["insurance"])?,
        &members,
    )
    .map_err(|err| format!("{err:?}"))?;
    let mut pairs = BTreeMap::new();
    for values in array(&input["proposed"])? {
        let [debtor, winner, charge] = array(values)? else {
            return Err("pair needs three fields".into());
        };
        let charge: u64 = number(charge)?;
        if charge == 0
            || pairs
                .insert((number::<u64>(debtor)?, number::<u64>(winner)?), charge)
                .is_some()
        {
            return Err("empty or repeated pair".into());
        }
    }
    let proposed: Vec<_> = book
        .pair_order()
        .map(|pair| pairs.remove(&pair).unwrap_or(0))
        .collect();
    if !pairs.is_empty() {
        return Err("unknown pair".into());
    }
    let budget: NonZeroU32 = number(&input["chunk"])?;
    let limit: BigUint = number(&input["limit"])?;
    let mut audit = book
        .begin(proposed.clone())
        .map_err(|err| format!("{err:?}"))?;
    let mut chunks = 0u64;
    while audit.verdict() == &Verdict::Pending && audit.cursor() < &limit {
        let remaining = &limit - audit.cursor();
        let width = if remaining < BigUint::from(budget.get()) {
            std::num::NonZeroU32::new(u32::try_from(remaining).map_err(|_| "range")?)
                .ok_or("empty range")?
        } else {
            budget
        };
        audit
            .advance(&book, &audit.cursor().clone(), width)
            .map_err(|err| format!("{err:?}"))?;
        chunks += 1;
        if audit.verdict() == &Verdict::Pending {
            let checkpoint = audit.checkpoint().map_err(|err| format!("{err:?}"))?;
            audit = Audit::resume_trusted(&book, proposed.clone(), checkpoint)
                .map_err(|err| format!("{err:?}"))?;
        }
    }
    let (status, challenger) = match audit.verdict() {
        Verdict::Pending => ("pending", None),
        Verdict::Verified => ("verified", None),
        Verdict::Outscored(at) => ("outscored", Some(at.to_string())),
    };
    let fills = audit.certified_pairs(&book).ok().map(|items| {
        items
            .into_iter()
            .map(|(debtor, winner, plan)| {
                [
                    debtor,
                    winner,
                    plan.charge,
                    plan.matched,
                    plan.base_ticks,
                    plan.extra_tick_lots,
                ]
                .map(|v| v.to_string())
            })
            .collect::<Vec<_>>()
    });
    Ok(
        json!({"status":status,"challenger":challenger,"checked":audit.cursor().to_string(),"space":book.candidates().to_string(),"chunks":chunks.to_string(),"fills":fills}),
    )
}
fn main() {
    for line in io::stdin().lock().lines() {
        let result = line
            .map_err(|e| e.to_string())
            .and_then(|line| serde_json::from_str(&line).map_err(|e| e.to_string()))
            .and_then(run);
        println!("{}", result.unwrap_or_else(|err| json!({"error":err})));
    }
}

//! One newline-delimited JSON frozen book in, one independently comparable plan out.
use financial_core::clearing::three_market::{settle, Amounts, FrozenRow, Market};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Book {
    markets: [MarketInput; 3],
    roster: Vec<String>,
    rows: Vec<RowInput>,
    vault: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MarketInput {
    id: u16,
    pool: String,
    insurance: String,
    fees: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RowInput {
    id: String,
    cash: String,
    claims: [String; 3],
}

fn strings(v: &Amounts) -> [String; 3] {
    v.each_ref().map(ToString::to_string)
}
fn evaluate(input: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let book: Book = serde_json::from_str(input)?;
    let mut markets = Vec::new();
    for m in book.markets {
        markets.push(Market {
            id: m.id,
            pool: m.pool.parse()?,
            insurance: m.insurance.parse()?,
            fees: m.fees.parse()?,
        });
    }
    let mut rows = Vec::new();
    for row in book.rows {
        let [a, b, c] = row.claims;
        rows.push(FrozenRow {
            id: row.id.parse()?,
            cash: row.cash.parse()?,
            claims: [a.parse()?, b.parse()?, c.parse()?],
        });
    }
    let roster = book
        .roster
        .iter()
        .map(|v| v.parse())
        .collect::<Result<Vec<_>, _>>()?;
    let plan = settle(
        markets.try_into().map_err(|_| "market count")?,
        &roster,
        &rows,
        book.vault.parse()?,
    )
    .map_err(|e| format!("{e:?}"))?;
    let members: Vec<_> = plan
        .rows
        .iter()
        .map(|row| {
            json!({
                "id": row.id.to_string(),
                "own": strings(&row.collections),
                "recovered": strings(&row.recovered),
                "forwarded": strings(&row.forwarded),
                "loss": strings(&row.impairment),
                "writeoff": strings(&row.writeoff),
                "entitlement": row.cash_entitlement.to_string(),
                "cash": row.cash.to_string(),
                "movements": row.movements.map(|movement| movement.to_string()),
            })
        })
        .collect();
    Ok(json!({
        "markets": plan.markets,
        "rates": strings(&plan.rates),
        "spent": plan.spent.map(|value| value.to_string()),
        "left": plan.insurance_left.map(|value| value.to_string()),
        "fees": plan.fees.map(|value| value.to_string()),
        "rows": members,
    }))
}
fn main() -> io::Result<()> {
    for line in io::stdin().lock().lines() {
        let result = evaluate(&line?).unwrap_or_else(|error| json!({"error": error.to_string()}));
        println!("{result}");
    }
    Ok(())
}

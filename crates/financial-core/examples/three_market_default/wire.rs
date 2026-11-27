//! Shared JSON test format for the native three-market comparison drivers.
use clearing_accounting::entry_cost::EntryCost;
use financial_core::clearing::three_market::{
    reduction::MarketPosition, Amounts, FrozenRow, Market, Plan,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Book {
    markets: [MarketInput; 3],
    roster: Vec<String>,
    rows: Vec<RowInput>,
    vault: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PositionInput {
    member: String,
    lots: String,
    entry_bytes: Vec<u8>,
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
pub type FrozenInputs = ([Market; 3], Vec<u64>, Vec<FrozenRow>, u64);
pub fn frozen(book: Book) -> Result<FrozenInputs, Box<dyn std::error::Error>> {
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
    let markets = markets.try_into().map_err(|_| "market count")?;
    let vault = book.vault.parse()?;
    Ok((markets, roster, rows, vault))
}

pub fn positions(
    inputs: Vec<PositionInput>,
) -> Result<Vec<MarketPosition>, Box<dyn std::error::Error>> {
    let mut positions = Vec::new();
    for entry in inputs {
        let lots = entry.lots.parse()?;
        if entry.entry_bytes.len() != EntryCost::BYTES {
            return Err("invalid entry width".into());
        }
        positions.push(MarketPosition {
            member: entry.member.parse()?,
            lots,
            entry: EntryCost::read(&entry.entry_bytes, lots).map_err(|e| format!("{e:?}"))?,
        });
    }
    Ok(positions)
}

pub fn plan_json(plan: &Plan) -> Value {
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
    json!({
        "markets": plan.markets,
        "rates": strings(&plan.rates),
        "spent": plan.spent.map(|value| value.to_string()),
        "left": plan.insurance_left.map(|value| value.to_string()),
        "fees": plan.fees.map(|value| value.to_string()),
        "rows": members,
    })
}

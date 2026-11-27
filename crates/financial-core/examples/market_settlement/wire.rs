//! Shared JSON test format for the native frozen-book comparison drivers.
use clearing_accounting::entry_cost::EntryCost;
use financial_core::clearing::market_settlement::{
    reduction::MarketPosition, Amounts, FrozenMarkets, FrozenRow, Market, Plan,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Book {
    markets: Vec<MarketInput>,
    market_roster: Option<Vec<u16>>,
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
    claims: Vec<String>,
}

fn strings(v: &Amounts) -> Vec<String> {
    v.iter().map(ToString::to_string).collect()
}
pub type FrozenInputs = (FrozenMarkets, Vec<u64>, Vec<FrozenRow>, u64);
pub fn frozen(
    book: Book,
    required_width: Option<usize>,
) -> Result<FrozenInputs, Box<dyn std::error::Error>> {
    if required_width.is_some_and(|width| book.markets.len() != width) {
        return Err("market count".into());
    }
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
        rows.push(FrozenRow {
            id: row.id.parse()?,
            cash: row.cash.parse()?,
            claims: row
                .claims
                .iter()
                .map(|c| c.parse())
                .collect::<Result<_, _>>()?,
        });
    }
    let roster = book
        .roster
        .iter()
        .map(|v| v.parse())
        .collect::<Result<Vec<_>, _>>()?;
    let expected = match (required_width, book.market_roster) {
        (None, Some(ids)) => ids,
        (Some(_), None) => markets.iter().map(|m| m.id).collect(),
        _ => return Err("market roster".into()),
    };
    let markets = FrozenMarkets::new(&expected, markets).map_err(|e| format!("{e:?}"))?;
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
                "movements": row.movements.iter().map(ToString::to_string).collect::<Vec<_>>(),
            })
        })
        .collect();
    json!({
        "markets": plan.markets,
        "rates": strings(&plan.rates),
        "spent": plan.spent.iter().map(ToString::to_string).collect::<Vec<_>>(),
        "left": plan.insurance_left.iter().map(ToString::to_string).collect::<Vec<_>>(),
        "fees": plan.fees.iter().map(ToString::to_string).collect::<Vec<_>>(),
        "rows": members,
    })
}

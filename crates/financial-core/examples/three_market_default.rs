//! One newline-delimited JSON frozen book in, one independently comparable plan out.
use clearing_accounting::entry_cost::EntryCost;
use financial_core::clearing::three_market::{
    reduction::{compare, FrozenPositions, MarketPosition, Proposal},
    settle, Amounts, FrozenRow, Market, Plan,
};
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
    reduction: Option<ReductionInput>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReductionInput {
    market: u16,
    mark: String,
    positions: Vec<PositionInput>,
    debtor: String,
    winner: String,
    charge: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PositionInput {
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
    let markets = markets.try_into().map_err(|_| "market count")?;
    let vault = book.vault.parse()?;
    let Some(input) = book.reduction else {
        return Ok(plan_json(
            &settle(markets, &roster, &rows, vault).map_err(|e| format!("{e:?}"))?,
        ));
    };
    let mut positions = Vec::new();
    for entry in input.positions {
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
    let compared = compare(
        markets,
        &roster,
        &rows,
        vault,
        FrozenPositions {
            market: input.market,
            mark: input.mark.parse()?,
            positions: &positions,
        },
        Proposal {
            debtor: input.debtor.parse()?,
            winner: input.winner.parse()?,
            charge: input.charge.parse()?,
        },
    )
    .map_err(|e| format!("{e:?}"))?;
    Ok(json!({
        "matched": compared.schedule.matched.to_string(),
        "baseTicks": compared.schedule.base_ticks.to_string(),
        "extraTickLots": compared.schedule.extra_tick_lots.to_string(),
        "debtorLotsAfter": compared.debtor_lots_after.to_string(),
        "winnerLotsAfter": compared.winner_lots_after.to_string(),
        "recovery": compared.recovery.to_string(),
        "settlement": plan_json(&compared.settlement),
    }))
}

fn plan_json(plan: &Plan) -> Value {
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
fn main() -> io::Result<()> {
    for line in io::stdin().lock().lines() {
        let result = evaluate(&line?).unwrap_or_else(|error| json!({"error": error.to_string()}));
        println!("{result}");
    }
    Ok(())
}

//! Native diagnostic inputs, in JSON lines. The complete book determines the eligible pairings.
#[path = "../../financial-core/examples/three_market_default/wire.rs"]
mod wire;
use default_plan_selection::three_market::select;
use financial_core::clearing::three_market::reduction::{competition::Contest, FrozenPositions};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    #[serde(flatten)]
    book: wire::Book,
    competition: Competition,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Competition {
    market: u16,
    mark: String,
    positions: Vec<wire::PositionInput>,
    venue: [u8; 32],
    episode: String,
    search_limit: String,
}

fn evaluate(input: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let input: Input = serde_json::from_str(input)?;
    let (markets, roster, rows, vault) = wire::frozen(input.book)?;
    let terms = input.competition;
    let positions = wire::positions(terms.positions)?;
    let book = Contest::freeze(
        markets,
        &roster,
        &rows,
        vault,
        FrozenPositions {
            market: terms.market,
            mark: terms.mark.parse()?,
            positions: &positions,
        },
    )
    .map_err(|e| format!("{e:?}"))?;
    let selected = select(
        &book,
        &terms.venue,
        terms.episode.parse()?,
        terms.search_limit.parse()?,
    )
    .map_err(|e| format!("{e:?}"))?;
    let selected = selected.ok_or("SearchLimit")?;
    let plan = selected.allocation;
    let winners: Vec<_> = book
        .winner_ids()
        .into_iter()
        .zip(plan.schedules)
        .map(|(id, fill)| {
            json!({
                "id": id.to_string(),
                "weight": fill.eligible.to_string(),
                "charge": fill.charge.to_string(),
                "matched": fill.matched.to_string(),
                "baseTicks": fill.base_ticks.to_string(),
                "extraTickLots": fill.extra_tick_lots.to_string(),
            })
        })
        .collect();
    Ok(json!({
        "debtor": book.debtor_id().to_string(),
        "budget": book.budget().to_string(),
        "winners": winners,
        "examined": selected.examined.to_string(),
        "recovery": plan.recovery.to_string(),
        "settlement": wire::plan_json(&plan.settlement),
    }))
}

fn main() -> io::Result<()> {
    for line in io::stdin().lock().lines() {
        println!(
            "{}",
            evaluate(&line?).unwrap_or_else(|error| json!({"error":error.to_string()}))
        );
    }
    Ok(())
}

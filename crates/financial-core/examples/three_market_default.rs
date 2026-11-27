//! One newline-delimited JSON frozen book in, one independently comparable plan out.
#[path = "three_market_default/wire.rs"]
mod wire;
use financial_core::clearing::three_market::{
    reduction::{compare, FrozenPositions, Proposal},
    settle,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead};
use wire::{plan_json, Book, PositionInput};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    #[serde(flatten)]
    book: Book,
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

fn evaluate(input: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let input: Input = serde_json::from_str(input)?;
    let (markets, roster, rows, vault) = wire::frozen(input.book)?;
    let Some(input) = input.reduction else {
        return Ok(plan_json(
            &settle(markets, &roster, &rows, vault).map_err(|e| format!("{e:?}"))?,
        ));
    };
    let positions = wire::positions(input.positions)?;
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

fn main() -> io::Result<()> {
    for line in io::stdin().lock().lines() {
        let result = evaluate(&line?).unwrap_or_else(|error| json!({"error": error.to_string()}));
        println!("{result}");
    }
    Ok(())
}

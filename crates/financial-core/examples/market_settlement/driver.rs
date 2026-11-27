//! One newline-delimited JSON frozen book in, one independently comparable plan out.
#[path = "wire.rs"]
mod wire;
use financial_core::clearing::market_settlement::{
    reduction::{compare, compare_plan, FrozenPositions, MarketLegs, Proposal},
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
    joint: Option<Vec<LegInput>>,
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
struct LegInput {
    market: u16,
    mark: String,
    positions: Vec<PositionInput>,
    charges: Vec<ChargeInput>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChargeInput {
    debtor: String,
    winner: String,
    charge: String,
}

fn evaluate(
    input: &str,
    required_width: Option<usize>,
) -> Result<Value, Box<dyn std::error::Error>> {
    let input: Input = serde_json::from_str(input)?;
    let (markets, roster, rows, vault) = wire::frozen(input.book, required_width)?;
    if let Some(legs) = input.joint {
        if required_width.is_some() || input.reduction.is_some() {
            return Err("ambiguous proposal".into());
        }
        let mut inputs = Vec::new();
        for leg in legs {
            let mut charges = Vec::new();
            for charge in leg.charges {
                charges.push(Proposal {
                    debtor: charge.debtor.parse()?,
                    winner: charge.winner.parse()?,
                    charge: charge.charge.parse()?,
                });
            }
            inputs.push((
                leg.market,
                leg.mark.parse::<u64>()?,
                wire::positions(leg.positions)?,
                charges,
            ));
        }
        let proposals = inputs
            .iter()
            .map(|(market, mark, positions, charges)| MarketLegs {
                exposure: FrozenPositions {
                    market: *market,
                    mark: *mark,
                    positions,
                },
                charges,
            })
            .collect::<Vec<_>>();
        let result = compare_plan(markets, &roster, &rows, vault, &proposals)
            .map_err(|e| format!("{e:?}"))?;
        return Ok(
            json!({"recovery":result.recovery.iter().map(ToString::to_string).collect::<Vec<_>>(),
            "matched":result.fills.iter().map(|(schedule,_,_)| schedule.matched.to_string()).collect::<Vec<_>>(),
            "settlement":plan_json(&result.settlement)}),
        );
    }
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

pub fn run(required_width: Option<usize>) -> io::Result<()> {
    for line in io::stdin().lock().lines() {
        let result = evaluate(&line?, required_width)
            .unwrap_or_else(|error| json!({"error": error.to_string()}));
        println!("{result}");
    }
    Ok(())
}

//! Line-oriented native diagnostic. Only the frozen account reads provide input
//! authority. A caller can propose paired charges and rate/order witnesses.
use default_plan_selection::joint::{Charge, FrozenBook, Member, Witness};
use financial_core::clearing::{
    row::Row,
    scalable::{number::Number, settlement::Proposal},
};
use num_bigint::BigUint;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{self, BufRead},
    str::FromStr,
};

#[derive(Deserialize)]
struct Input {
    rows: Vec<MemberInput>,
    marks: [String; 2],
    pools: [String; 2],
    insurance: [String; 2],
    fees: [String; 2],
    charges: Vec<[String; 4]>,
    original: WitnessInput,
    effective: WitnessInput,
    search: Option<Search>,
    pair_order: Option<Episode>,
    #[serde(default)]
    measure_recovery_bound: bool,
}
#[derive(Deserialize)]
struct Episode {
    venue_hex: String,
    epoch: String,
}
#[derive(Deserialize)]
struct Search {
    hint: Option<Vec<[String; 4]>>,
    venue_hex: String,
    epoch: String,
    reflections: Vec<Vec<usize>>,
    limit: String,
    witnesses: Vec<Candidate>,
}
#[derive(Deserialize)]
struct Candidate {
    charges: Vec<[String; 4]>,
    effective: WitnessInput,
}
#[derive(Deserialize)]
struct MemberInput {
    id: String,
    cash: String,
    claims: [String; 2],
    lots: [String; 2],
    history: [String; 2],
}
#[derive(Deserialize)]
struct WitnessInput {
    rates: Vec<[String; 3]>,
    orders: [Vec<String>; 2],
}
fn decimal<T: FromStr>(text: &str) -> Result<T, String> {
    text.parse().map_err(|_| "invalid decimal".into())
}
fn pair<T: FromStr>(values: &[String; 2]) -> Result<[T; 2], String> {
    Ok([decimal(&values[0])?, decimal(&values[1])?])
}
fn bytes(text: &str) -> Result<Vec<u8>, String> {
    if !text.is_ascii() || text.len() % 2 != 0 {
        return Err("invalid history hex".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).map_err(|_| "invalid history hex".into()))
        .collect()
}
struct RatesAndOrders {
    rates: Vec<Proposal>,
    orders: [Vec<u64>; 2],
}
impl WitnessInput {
    fn parse(&self) -> Result<RatesAndOrders, String> {
        let wide = |s: &str| decimal::<BigUint>(s).map(|n| Number::from_words(n.to_u64_digits()));
        let order = |rows: &[String]| {
            rows.iter()
                .map(|s| decimal(s))
                .collect::<Result<Vec<_>, String>>()
        };
        let rates = self
            .rates
            .iter()
            .map(|[factor, btc, eth]| {
                Ok(Proposal {
                    factor: wide(factor)?,
                    rates: [wide(btc)?, wide(eth)?],
                })
            })
            .collect::<Result<_, String>>()?;
        Ok(RatesAndOrders {
            rates,
            orders: [order(&self.orders[0])?, order(&self.orders[1])?],
        })
    }
}
impl RatesAndOrders {
    fn witness(&self) -> Witness<'_> {
        Witness {
            rates: &self.rates,
            orders: [&self.orders[0], &self.orders[1]],
        }
    }
}
fn decode_charges(rows: &[[String; 4]]) -> Result<Vec<Charge>, String> {
    rows.iter()
        .map(|[market, debtor, winner, atoms]| {
            Ok(Charge {
                market: decimal(market)?,
                debtor: decimal(debtor)?,
                winner: decimal(winner)?,
                atoms: decimal(atoms)?,
            })
        })
        .collect()
}
fn run(input: Input) -> Result<Value, String> {
    let histories = input
        .rows
        .iter()
        .map(|row| Ok([bytes(&row.history[0])?, bytes(&row.history[1])?]))
        .collect::<Result<Vec<_>, String>>()?;
    let members = input
        .rows
        .iter()
        .zip(&histories)
        .map(|(row, history)| {
            Ok(Member {
                id: decimal(&row.id)?,
                lots: pair(&row.lots)?,
                history: [&history[0], &history[1]],
                row: Row {
                    cash: decimal(&row.cash)?,
                    claims: pair(&row.claims)?,
                },
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let book = FrozenBook {
        members: &members,
        marks: pair(&input.marks)?,
        pools: pair(&input.pools)?,
        insurance: pair(&input.insurance)?,
        fees: pair(&input.fees)?,
    };
    if let Some(search) = input.search {
        use default_plan_selection::joint_search::Coverage;
        let mut witnesses = std::collections::BTreeMap::new();
        for row in search.witnesses {
            let mut charges = decode_charges(&row.charges)?;
            charges.sort_unstable();
            if witnesses.insert(charges, row.effective.parse()?).is_some() {
                return Err("duplicate schedule witness".into());
            }
        }
        let venue: [u8; 32] = bytes(&search.venue_hex)?
            .try_into()
            .map_err(|_| "invalid venue")?;
        let priority = default_plan_selection::joint_search::FrozenPriority {
            venue: &venue,
            episode: decimal(&search.epoch)?,
            reflections: &search.reflections,
        };
        let wire = |plan: Vec<Charge>| {
            plan.into_iter()
                .map(|c| {
                    [
                        c.market.to_string(),
                        c.debtor.to_string(),
                        c.winner.to_string(),
                        c.atoms.to_string(),
                    ]
                })
                .collect::<Vec<_>>()
        };
        if let Some(hint) = search.hint {
            let result = book
                .cover_ranges(
                    input.original.parse()?.witness(),
                    &decode_charges(&hint)?,
                    decimal(&search.limit)?,
                    priority,
                    |charges| witnesses.get(charges).map(RatesAndOrders::witness),
                )
                .map_err(|e| format!("{e:?}"))?;
            return Ok(
                json!({"combinations":result.combinations.to_string(),"nodes":result.cost.nodes.to_string(),
                "leaves":result.cost.leaves.to_string(),"verified":result.cost.verified.to_string(),
                "pruned":result.cost.pruned.to_string(),"selected":result.selected.map(wire),
                "finalists":result.finalists.map(|plans|plans.into_iter().map(wire).collect::<Vec<_>>())}),
            );
        }
        let result = book
            .recovery_frontier(
                input.original.parse()?.witness(),
                decimal(&search.limit)?,
                priority,
                |charges| witnesses.get(charges).map(RatesAndOrders::witness),
            )
            .map_err(|e| format!("{e:?}"))?;
        return Ok(match result {
            Coverage::OverBudget { at_least } => json!({"atLeast":at_least.to_string()}),
            Coverage::Complete {
                combinations,
                structurally_valid,
                admitted,
                finalists,
                selected,
            } => json!({
                "combinations":combinations.to_string(),"valid":structurally_valid.to_string(),"admitted":admitted.to_string(),
                "finalists":finalists.into_iter().map(wire).collect::<Vec<_>>(),"selected":selected.map(wire)
            }),
        });
    }
    let charges = decode_charges(&input.charges)?;
    let original = input.original.parse()?;
    let effective = input.effective.parse()?;
    let (receipt, pair_order) = if let Some(episode) = input.pair_order {
        let venue = bytes(&episode.venue_hex)?
            .try_into()
            .map_err(|_| "invalid venue")?;
        let (receipt, certified) = book
            .verify_with_pair_order(
                original.witness(),
                effective.witness(),
                &charges,
                &venue,
                decimal(&episode.epoch)?,
            )
            .map_err(|err| format!("{err:?}"))?;
        (receipt, Some(certified))
    } else {
        (
            book.verify_proposal(original.witness(), effective.witness(), &charges)
                .map_err(|err| format!("{err:?}"))?,
            None,
        )
    };
    let mut result = json!({
        "budgets":receipt.budgets.iter().map(|row|row.map(|x|x.to_string())).collect::<Vec<_>>(),
        "fills": receipt.fills.iter().map(|p|[p.charge,p.matched,p.base_ticks,p.extra_tick_lots].map(|x|x.to_string())).collect::<Vec<_>>(),
        "lots":receipt.remaining_lots.iter().map(|row|row.map(|x|x.to_string())).collect::<Vec<_>>(),
        "cash":receipt.rounded.cash.iter().map(u64::to_string).collect::<Vec<_>>(),
        "movements":receipt.rounded.movements.iter().map(|row|row.map(|x|x.to_string())).collect::<Vec<_>>(),
        "insuranceSpent":receipt.spent.map(|x|x.to_string()),
        "recovered":receipt.recovered.each_ref().map(|(numerator,denominator)|[numerator.to_string(),denominator.to_string()]),
    });
    if let Some(certified) = pair_order {
        result["pairOrderAtFixedTotals"] = json!(certified);
    }
    if input.measure_recovery_bound {
        result["recoveryCeilings"] =
            json!(receipt.recovery_ceilings().map(|value| value.to_string()));
        result["bothCeilingsReached"] = json!(receipt.reaches_both_recovery_ceilings());
    }
    Ok(result)
}
fn main() {
    for line in io::stdin().lock().lines().map_while(Result::ok) {
        let result = serde_json::from_str(&line)
            .map_err(|e| e.to_string())
            .and_then(run);
        println!("{}", result.unwrap_or_else(|error| json!({"error": error})));
    }
}

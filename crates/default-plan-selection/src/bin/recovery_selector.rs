//! Off-chain front end for the same exact financial comparison used by clearing.
//! The first request derives dimensions. The second supplies per-rank calculation
//! witnesses. Neither request supplies an incumbent or a list of competing plans.
use default_plan_selection::{
    joint::{Charge, FrozenBook, Member, Witness},
    joint_search::{Coverage, FrozenPriority},
};
use financial_core::clearing::{
    row::Row,
    scalable::{number::Number, settlement::Proposal},
};
use num_bigint::BigUint;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{io, str::FromStr};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    venue: [u8; 32],
    epoch: String,
    rows: Vec<FrozenRow>,
    marks: [String; 2],
    pools: [String; 2],
    insurance: [String; 2],
    fees: [String; 2],
    original: InputWitness,
    budget: u64,
    witnesses: Option<Vec<Option<InputWitness>>>,
}

#[derive(Deserialize)]
struct FrozenRow {
    id: String,
    cash: String,
    lots: [String; 2],
    claims: [String; 2],
    history: [Vec<u8>; 2],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InputWitness {
    rates: [String; 3],
    #[serde(default)]
    additional_rates: Vec<[String; 3]>,
    orders: [Vec<u64>; 2],
}
struct Calculation {
    proposals: Vec<Proposal>,
    orders: [Vec<u64>; 2],
}
fn number<T: FromStr>(value: &str) -> Result<T, String> {
    value.parse().map_err(|_| "invalid decimal".into())
}
fn pair<T: FromStr>(values: &[String; 2]) -> Result<[T; 2], String> {
    Ok([number(&values[0])?, number(&values[1])?])
}
impl InputWitness {
    fn parse(&self) -> Result<Calculation, String> {
        if self.additional_rates.len() > 2 {
            return Err("two markets admit at most three rate calculations".into());
        }
        let amount = |text: &str| {
            number::<BigUint>(text).map(|value| Number::from_words(value.to_u64_digits()))
        };
        let proposals = std::iter::once(&self.rates)
            .chain(&self.additional_rates)
            .map(|[factor, btc, eth]| {
                Ok(Proposal {
                    factor: amount(factor)?,
                    rates: [amount(btc)?, amount(eth)?],
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Calculation {
            proposals,
            orders: self.orders.clone(),
        })
    }
}
impl Calculation {
    fn witness(&self) -> Witness<'_> {
        Witness {
            rates: &self.proposals,
            orders: [&self.orders[0], &self.orders[1]],
        }
    }
}

struct Pair {
    market: usize,
    debtor: u64,
    winner: u64,
    maximum: u64,
}

/// Native search emits the nonzero charges in the original dimension order.
fn rank(edges: &[Pair], charges: &[Charge]) -> Option<u64> {
    let mut remaining = charges.iter().peekable();
    let mut rank = 0u64;
    for edge in edges {
        let atoms = remaining
            .next_if(|c| (c.market, c.debtor, c.winner) == (edge.market, edge.debtor, edge.winner))
            .map_or(0, |charge| charge.atoms);
        if atoms > edge.maximum {
            return None;
        }
        rank = rank
            .checked_mul(edge.maximum.checked_add(1)?)?
            .checked_add(atoms)?;
    }
    remaining.next().is_none().then_some(rank)
}

// Diagnostic only. A size or dimension count never authorizes a recovery plan.
fn calculate(input: Request, measure: bool) -> Result<Value, String> {
    let members = input
        .rows
        .iter()
        .map(|row| {
            Ok(Member {
                id: number(&row.id)?,
                lots: pair(&row.lots)?,
                row: Row {
                    cash: number(&row.cash)?,
                    claims: pair(&row.claims)?,
                },
                history: [&row.history[0], &row.history[1]],
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
    let original = input.original.parse()?;
    let failure = |err| format!("frozen book: {err:?}");
    let budgets = book.edge_budgets(original.witness()).map_err(failure)?;
    if measure {
        let mut edges = [0u64; 2];
        let mut schedules = BigUint::from(1u8);
        book.visit_edges(&budgets, |edge| {
            edges[edge.market] += 1;
            schedules *= BigUint::from(edge.maximum) + 1u8;
            Ok(true)
        })
        .map_err(failure)?;
        return Ok(json!({
            "edgesByMarket": edges,
            "schedules": schedules.to_string(),
            "rankBits": (schedules - 1u8).bits(),
        }));
    }
    let mut edges = Vec::new();
    let mut count = 1u64;
    let complete = book
        .visit_edges(&budgets, |edge| {
            let Some(next) = edge
                .maximum
                .checked_add(1)
                .and_then(|radix| count.checked_mul(radix))
            else {
                return Ok(false);
            };
            if next > input.budget {
                return Ok(false);
            }
            count = next;
            edges.push(Pair {
                market: edge.market,
                debtor: members[edge.debtor].id,
                winner: members[edge.winner].id,
                maximum: edge.maximum,
            });
            Ok(true)
        })
        .map_err(failure)?;
    if !complete || count > input.budget {
        return Ok(json!({"blocked":"schedule-budget"}));
    }
    let Some(witnesses) = input.witnesses else {
        return Ok(
            json!({"count":count.to_string(),"edges":edges.iter().map(|e|json!({
            "market":e.market,"debtor":e.debtor.to_string(),"winner":e.winner.to_string(),"maximum":e.maximum.to_string()
        })).collect::<Vec<_>>()}),
        );
    };
    if witnesses.len() as u64 != count {
        return Err("incomplete witness table".into());
    }
    let witnesses = witnesses
        .iter()
        .map(|entry| entry.as_ref().map(InputWitness::parse).transpose())
        .collect::<Result<Vec<_>, _>>()?;
    let priority = FrozenPriority {
        venue: &input.venue,
        episode: number(&input.epoch)?,
        reflections: &[],
    };
    let mut missing = false;
    let coverage = book.recovery_frontier(original.witness(), input.budget, priority, |charges| {
        let entry = rank(&edges, charges)
            .and_then(|n| witnesses.get(n as usize))
            .and_then(Option::as_ref);
        if entry.is_none() {
            missing = true;
        }
        entry.map(Calculation::witness)
    });
    if missing {
        return Ok(json!({"blocked":"unsupported-rate-witness"}));
    }
    match coverage.map_err(failure)? {
        Coverage::Complete {
            combinations,
            selected: Some(charges),
            ..
        } if combinations == count => {
            let result = rank(&edges, &charges).ok_or("invalid selection dimensions")?;
            Ok(json!({"rank":result.to_string(),"count":count.to_string()}))
        }
        Coverage::Complete { selected: None, .. } => Ok(json!({"blocked":"incomparable-plans"})),
        _ => Err("inconsistent native search coverage".into()),
    }
}

fn main() -> Result<(), String> {
    let input = serde_json::from_reader(io::stdin().lock()).map_err(|e| e.to_string())?;
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    let measure = match arguments.as_slice() {
        [] => false,
        [flag] if flag == "--dimensions" => true,
        _ => return Err("expected no arguments or --dimensions".into()),
    };
    println!("{}", calculate(input, measure)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ninth_flat_creditor_and_three_insurance_passes_are_verified_together() {
        let mut rows: Vec<_> = (0..9)
            .map(|member| {
                json!({"id":(member*100+2).to_string(),"cash":"0",
                "claims":["0","0"],"lots":["0","0"],"history":[[],[]]})
            })
            .collect();
        for (index, cash, btc, eth) in [
            (0, "2", "0", "0"),
            (1, "1", "-600000000", "600000000"),
            (2, "2", "200000000", "-800000000"),
            (8, "2", "1400000000", "1200000000"),
        ] {
            rows[index]["cash"] = json!(cash);
            rows[index]["claims"] = json!([btc, eth]);
        }
        // Independent rational settlement clips ETH, then BTC, and pays the
        // ninth member one funded atom from each originating market.
        let witness = json!({
            "rates":["1","1","1"], "additionalRates":[["3","3","2"],["23","20","15"]],
            "orders":[[8,2,0,1,3,4,5,6,7],[8,1,0,2,3,4,5,6,7]]
        });
        let request = json!({"venue":vec![3u8;32],"epoch":"1","rows":rows,"marks":["100","200"],
            "insurance":["1","1"],"fees":["0","0"],"pools":["1","1"],"budget":1,
            "original":witness,"witnesses":[witness]});
        assert_eq!(
            calculate(serde_json::from_value(request.clone()).unwrap(), true).unwrap(),
            json!({"edgesByMarket":[0,0], "schedules":"1", "rankBits":0})
        );
        let run = |value| calculate(serde_json::from_value(value).unwrap(), false);
        assert_eq!(
            run(request.clone()).unwrap(),
            json!({"rank":"0","count":"1"})
        );
        let mut missing = request.clone();
        missing["original"]["additionalRates"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert!(run(missing).is_err());
        let mut partial = request;
        partial["original"]["orders"][0] = json!([2, 0, 1, 3, 4, 5, 6, 7]);
        assert!(run(partial).is_err());
    }

    #[test]
    fn sparse_member_ids_and_missing_digits_recover_wire_rank() {
        let edges = [
            Pair {
                market: 0,
                debtor: 94,
                winner: 7,
                maximum: 8,
            },
            Pair {
                market: 0,
                debtor: 94,
                winner: 21,
                maximum: 4,
            },
            Pair {
                market: 1,
                debtor: 21,
                winner: 94,
                maximum: 3,
            },
        ];
        for (ordinal, (btc_left, btc_right, eth)) in (0..9)
            .flat_map(|a| (0..5).flat_map(move |b| (0..4).map(move |c| (a, b, c))))
            .enumerate()
        {
            let charges: Vec<_> = edges
                .iter()
                .zip([btc_left, btc_right, eth])
                .filter(|(_, amount)| *amount != 0)
                .map(|(e, atoms)| Charge {
                    market: e.market,
                    debtor: e.debtor,
                    winner: e.winner,
                    atoms,
                })
                .collect();
            assert_eq!(rank(&edges, &charges), Some(ordinal as u64));
        }
        let foreign = Charge {
            market: 0,
            debtor: 0,
            winner: 0,
            atoms: 1,
        };
        assert_eq!(rank(&edges, &[foreign]), None);
    }
}

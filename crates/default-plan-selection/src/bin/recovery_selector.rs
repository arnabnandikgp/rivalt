//! Off-chain front end for the same exact financial comparison used by clearing.
//! The first request derives dimensions. The second supplies per-rank calculation
//! witnesses. Neither request supplies an incumbent or a list of competing plans.
use default_plan_selection::{
    joint::{Charge, FrozenBook, Member, Witness},
    joint_search::{Coverage, FrozenPriority},
};
use financial_core::clearing::{row::Row, scalable::settlement::Proposal};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{io, str::FromStr};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    venue: [u8; 32],
    epoch: String,
    rows: [FrozenRow; 8],
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
struct InputWitness {
    rates: [String; 3],
    orders: [[u8; 8]; 2],
}
struct Calculation {
    proposal: [Proposal; 1],
    orders: [[u64; 8]; 2],
}
fn number<T: FromStr>(value: &str) -> Result<T, String> {
    value.parse().map_err(|_| "invalid decimal".into())
}
fn pair<T: FromStr>(values: &[String; 2]) -> Result<[T; 2], String> {
    Ok([number(&values[0])?, number(&values[1])?])
}
impl InputWitness {
    fn parse(&self) -> Result<Calculation, String> {
        let word = |index: usize| number::<u64>(&self.rates[index]).map(u128::from);
        Ok(Calculation {
            proposal: [Proposal {
                factor: word(0)?.into(),
                rates: [word(1)?.into(), word(2)?.into()],
            }],
            orders: self.orders.map(|order| order.map(u64::from)),
        })
    }
}
impl Calculation {
    fn witness(&self) -> Witness<'_> {
        Witness {
            rates: &self.proposal,
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

fn select(input: Request) -> Result<Value, String> {
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
    println!("{}", select(input)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

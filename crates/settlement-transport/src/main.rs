//! Bounded, untrusted page-descriptor transport for the native operator. It
//! neither signs transactions nor computes payouts. Clearing authenticates the
//! same public checkpoints and derives every requested page again at execution.
use anchor_lang::{AccountDeserialize, Space};
use clearing::{
    instructions::account_safety::settlement::{
        denominator_plan, rate_plan, settlement_application_pages, settlement_plan_pages,
        settlement_plan_row_pages,
    },
    state::accounts::{PreparedSettlement, SettlementPlan, SettlementRates, SCHEMA_VERSION},
};
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

const MAX_INPUT: u64 = 32 * 1024;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u8,
    operation: Operation,
    prepared: String,
    rates: String,
    plan: String,
    ordinal: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Operation {
    Denominator,
    Rate,
    Plan,
    PlanRow,
    Application,
}
#[derive(Serialize)]
struct Response {
    version: u8,
    schema: u16,
    pages: Vec<Page>,
}
#[derive(Serialize)]
struct Page {
    register: u32,
    index: String,
    writable: bool,
}
fn decode<T: AccountDeserialize + Space>(text: &str) -> Result<T, String> {
    if text.len() != 2 * (8 + T::INIT_SPACE)
        || !text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("noncanonical account encoding or size".into());
    }
    let bytes: Result<Vec<u8>, _> = text
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16))
        .collect();
    T::try_deserialize(&mut bytes.map_err(|_| "invalid hex")?.as_slice())
        .map_err(|_| "invalid account discriminator/layout".into())
}
fn describe(input: &str) -> Result<Response, String> {
    let request: Request = serde_json::from_str(input).map_err(|_| "invalid request")?;
    if request.version != 1 {
        return Err("unsupported transport version".into());
    }
    let prepared: PreparedSettlement = decode(&request.prepared)?;
    let rates: SettlementRates = decode(&request.rates)?;
    let plan: SettlementPlan = decode(&request.plan)?;
    if prepared.schema_version != SCHEMA_VERSION
        || rates.schema_version != SCHEMA_VERSION
        || plan.schema_version != SCHEMA_VERSION
        || prepared.venue != rates.venue
        || prepared.venue != plan.venue
        || prepared.revision == 0
        || rates.revision == 0
        || plan.revision == 0
        || prepared.epoch == 0
    {
        return Err("foreign or uninitialized checkpoint".into());
    }
    let pages = match request.operation {
        Operation::PlanRow => {
            let text = request.ordinal.ok_or("missing row ordinal")?;
            let ordinal: u64 = text.parse().map_err(|_| "invalid row ordinal")?;
            if text != ordinal.to_string() {
                return Err("noncanonical row ordinal".into());
            }
            settlement_plan_row_pages(&prepared, &rates, &plan, ordinal)
        }
        operation => {
            if request.ordinal.is_some() {
                return Err("unexpected row ordinal".into());
            }
            match operation {
                Operation::Denominator => denominator_plan(&prepared),
                Operation::Rate => rate_plan(&prepared, &rates),
                Operation::Plan => settlement_plan_pages(&prepared, &rates, &plan),
                Operation::Application => {
                    if plan.epoch != prepared.epoch {
                        return Err("foreign application epoch".into());
                    }
                    settlement_application_pages(&prepared, &plan)
                }
                Operation::PlanRow => unreachable!(),
            }
        }
    }
    .map_err(|_| "checkpoint cannot request this operation")?;
    Ok(Response {
        version: 1,
        schema: SCHEMA_VERSION,
        pages: pages
            .requests()
            .iter()
            .map(|page| Page {
                register: page.register,
                index: page.index.to_string(),
                writable: page.writable,
            })
            .collect(),
    })
}
fn run() -> Result<(), String> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_INPUT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "read failed")?;
    if bytes.len() > MAX_INPUT as usize {
        return Err("request too large".into());
    }
    let input = std::str::from_utf8(&bytes).map_err(|_| "invalid utf8")?;
    let output = describe(input)?;
    println!(
        "{}",
        serde_json::to_string(&output).map_err(|_| "encode failed")?
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("settlement page request rejected: {error}");
        std::process::exit(1);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn encoded<
        T: anchor_lang::wincode::SchemaWrite<anchor_lang::BorshConfig, Src = T>
            + anchor_lang::Discriminator,
    >(
        value: &T,
    ) -> String {
        let mut bytes = T::DISCRIMINATOR.to_vec();
        bytes.extend(
            anchor_lang::wincode::config::serialize(value, anchor_lang::BORSH_CONFIG).unwrap(),
        );
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
    #[test]
    fn literal_initial_denominator_and_application_page() {
        use financial_core::clearing::scalable::{
            cohort_denominator::DenominatorPass, wide::required_limbs,
        };
        let mut prepared = PreparedSettlement {
            schema_version: SCHEMA_VERSION,
            revision: 1,
            epoch: 1,
            count: 8,
            stage: 2,
            ..Default::default()
        };
        prepared.state.denominator = DenominatorPass::new(8, required_limbs(8).unwrap())
            .unwrap()
            .checkpoint();
        let rates = SettlementRates {
            schema_version: SCHEMA_VERSION,
            revision: 1,
            ..Default::default()
        };
        let plan = SettlementPlan {
            schema_version: SCHEMA_VERSION,
            revision: 1,
            epoch: 1,
            stage: 9,
            cursor: 3,
            ..Default::default()
        };
        let mut input = serde_json::json!({"version":1,"operation":"denominator","prepared":encoded(&prepared),
            "rates":encoded(&rates),"plan":encoded(&plan),"ordinal":null});
        let initial = describe(&input.to_string()).unwrap();
        assert_eq!(
            serde_json::to_value(initial).unwrap(),
            serde_json::json!({"version":1,"schema":10,
            "pages":[{"register":0,"index":"0","writable":true}]})
        );
        input["operation"] = "application".into();
        let application = describe(&input.to_string()).unwrap();
        assert_eq!(
            serde_json::to_value(application).unwrap(),
            serde_json::json!({"version":1,"schema":10,
            "pages":[{"register":66,"index":"0","writable":false}]})
        );
        input["ordinal"] = "0".into();
        assert!(describe(&input.to_string()).is_err());
    }
    #[test]
    fn reject_noncanonical_transport_without_panicking() {
        for input in [
            "",
            "{}",
            r#"{"version":2,"operation":"plan","prepared":"","rates":"","plan":"","ordinal":null}"#,
            r#"{"version":1,"operation":"unknown","prepared":"","rates":"","plan":"","ordinal":null}"#,
        ] {
            assert!(describe(input).is_err());
        }
        assert!(decode::<SettlementPlan>("00").is_err());
    }
}

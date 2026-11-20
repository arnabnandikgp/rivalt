//! Replay a single held ETH observation from finalized trade and publication
//! receipts. Run the TypeScript reader to decode the actual on-chain inputs.
use financial_core::oracle::prefix::FundingWindow;
use std::io::{self, Read};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let numbers = input
        .split_whitespace()
        .map(str::parse::<i128>)
        .collect::<Result<Vec<_>, _>>()?;
    let [market, config, observation, start_slot, start, end, held_slot, base, premium, first_slot, first_time, first_index, second_slot, second_time, second_index, read_slot, recovered] =
        numbers[..]
    else {
        return Err("invalid signed funding replay".into());
    };
    let window = FundingWindow {
        market: market.try_into()?,
        config: config.try_into()?,
        observation: observation.try_into()?,
        sample_slot: start_slot.try_into()?,
        sampled_at: start.try_into()?,
        held_until: end.try_into()?,
        held_slot: held_slot.try_into()?,
        base,
        premium,
    };
    let observe = |slot: i128, time: i128| -> Result<_, Box<dyn std::error::Error>> {
        window
            .observe(slot.try_into()?, time.try_into()?)
            .map_err(|_| "invalid observation")?
            .ok_or_else(|| "ineligible funding stamp".into())
    };
    let eth = observe(first_slot, first_time)?;
    let btc = observe(second_slot, second_time)?;
    let verify = |lanes, expected| -> Result<(), Box<dyn std::error::Error>> {
        let fold = window
            .resolve(None, lanes, read_slot.try_into()?)
            .map_err(|_| "invalid target-market lanes")?;
        if fold.index != expected {
            return Err("does not match signed funding".into());
        }
        Ok(())
    };
    verify([Some(eth), None, None], first_index)?;
    // A maker selected for BTC writes a checkpoint for the ETH exposure too.
    // Different lane assignments must yield the same causal result.
    verify([Some(eth), Some(btc), None], second_index)?;
    verify([Some(btc), None, None], recovered)?;
    if first_index == recovered {
        return Err("case does not discriminate missing sibling update".into());
    }
    println!("ETH-only {first_index}, complete {second_index}, recovered {recovered}");
    Ok(())
}

//! Compare each decoded signed fill with the existing program's gross total.
//! Input per line: market, selected maker, observed post-fill gross, then pairs
//! of original and resulting lots for each of the actual touched roots.
use financial_core::{
    gross_capacity::{admit_with_donors, GrossChange, Headroom},
    MAX_GROSS_LOTS,
};
use std::io::{self, BufRead};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut markets = [Headroom::distribute(0).unwrap(); 2];
    let mut count = 0;
    let mut fallbacks = 0;
    for line in io::stdin().lock().lines() {
        let numbers: Vec<i64> = line?
            .split_whitespace()
            .map(str::parse)
            .collect::<Result<_, _>>()?;
        if numbers.len() != 7 && numbers.len() != 9 {
            return Err("wrong number of positions".into());
        }
        let market = usize::try_from(numbers[0])?;
        let maker = usize::try_from(numbers[1])?;
        let expected = u64::try_from(numbers[2])?;
        let positions: Vec<_> = numbers[3..].chunks_exact(2).map(|p| (p[0], p[1])).collect();
        let delta = GrossChange::from_positions(&positions)
            .map_err(|_| "invalid signed position change")?;
        let lanes = markets.get_mut(market).ok_or("invalid market")?;
        let local = lanes.get_mut(maker).ok_or("unknown maker")?;
        if let Ok(next) = local.apply(delta) {
            *local = next;
        } else {
            *lanes =
                admit_with_donors(*lanes, maker, delta).map_err(|_| "gross capacity exhausted")?;
            fallbacks += 1;
        }
        let available: u64 = lanes.iter().map(|lane| lane.available()).sum();
        if MAX_GROSS_LOTS.checked_sub(available) != Some(expected) {
            return Err("disagrees with signed post-fill market gross".into());
        }
        count += 1;
    }
    if count == 0 {
        return Err("empty replay".into());
    }
    println!("{count} fills, {fallbacks} rebalances");
    Ok(())
}

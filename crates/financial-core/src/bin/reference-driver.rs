//! Deliberately tiny line protocol for the independent Python rational oracle.
use financial_core::*;
use std::io::{self, BufRead};

fn main() {
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        let args: Vec<_> = line.split_whitespace().collect();
        match args[0] {
            "profile" => println!(
                "{} {} {} {} {} {} {} {} {} {} {}",
                SCALE,
                LOTS_PER_BTC,
                MAX_LOTS,
                MAX_GROSS_LOTS,
                MAX_PRICE,
                MAX_CASH,
                MAX_SCALED,
                MAX_FUNDING,
                IM_BPS,
                MM_BPS,
                MIN_ORDER_ATOMS
            ),
            "allocate" => {
                let total = args[1].parse().unwrap();
                let weights: Vec<_> = args[2..]
                    .chunks_exact(2)
                    .map(|p| (p[0].parse().unwrap(), p[1].parse().unwrap()))
                    .collect();
                let result = apportion(total, &weights).unwrap();
                println!(
                    "{}",
                    result
                        .iter()
                        .map(|n| n.to_string())
                        .collect::<Vec<_>>()
                        .join(" ")
                );
            }
            "fund" => {
                let mut p = Participant {
                    lots: args[1].parse().unwrap(),
                    virtual_scaled: args[2].parse().unwrap(),
                    funding_checkpoint: args[3].parse().unwrap(),
                    ..Participant::default()
                };
                for f in &args[4..] {
                    p = p.accrued(f.parse().unwrap()).unwrap();
                }
                println!("{}", p.virtual_scaled);
            }
            "default" => {
                let insurance = args[1].parse().unwrap();
                let settlement = args[2].parse().unwrap();
                let cohort: Vec<_> = args[3..]
                    .chunks_exact(3)
                    .map(|a| Participant {
                        id: a[0].parse().unwrap(),
                        cash: a[1].parse().unwrap(),
                        virtual_scaled: a[2].parse().unwrap(),
                        ..Participant::default()
                    })
                    .collect();
                let pools = Pools {
                    vault: insurance + settlement + cohort.iter().map(|p| p.cash).sum::<u64>(),
                    insurance,
                    settlement,
                    fees: 0,
                };
                let out = closeout(&cohort, pools, 1, 0).unwrap();
                let mut result = vec![out.pools.insurance.to_string()];
                for (i, p) in out.participants.iter().enumerate() {
                    result.extend([
                        p.cash.to_string(),
                        out.impaired_scaled[i].to_string(),
                        out.rounding_scaled[i].to_string(),
                    ]);
                }
                println!("{}", result.join(" "));
            }
            _ => panic!("unknown reference operation"),
        }
    }
}

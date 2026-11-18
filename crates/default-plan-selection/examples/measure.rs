//! Input lines are episode, budget and six gains, separated by spaces.
use default_plan_selection::{candidate, priorities, score_weights, valid_book, Plan, PARTITIONS};
use std::{
    hint::black_box,
    io::{self, BufRead},
    time::Instant,
};

fn main() {
    let repeats: u32 = std::env::args()
        .nth(1)
        .map(|arg| arg.parse().unwrap())
        .unwrap_or(1);
    assert!(repeats > 0);
    for line in io::stdin().lock().lines().map_while(Result::ok) {
        let values: Vec<u16> = line
            .split_whitespace()
            .map(|field| field.parse().unwrap())
            .collect();
        let gains = values[2..].try_into().unwrap();
        let budget = values[1];
        assert!(valid_book(budget, &gains, 10));
        let started = Instant::now();
        let mut best = Plan::default();
        for _ in 0..repeats {
            let (order, debtor) = priorities(black_box(&[7; 32]), u64::from(values[0]));
            let weights = score_weights(black_box(&gains));
            best = Plan::default();
            for partition in 0..PARTITIONS {
                let next = candidate(partition, budget, &gains, &weights, &order, debtor);
                if next.beats(&best, &order, debtor) {
                    best = next;
                }
            }
            black_box(&best);
        }
        let elapsed = started.elapsed().as_nanos();
        println!(
            "{} {} {} {} {}",
            best.recovered,
            best.debtor_mask,
            best.charges.map(|q| q.to_string()).join(","),
            best.sharing_cost,
            elapsed / u128::from(repeats)
        );
    }
}

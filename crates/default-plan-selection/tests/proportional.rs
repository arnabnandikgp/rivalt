// Independent oracle: enumerate whole allocations, score the full squared-cost
// expression over a common denominator, then compare total lots and episode order.
use default_plan_selection::{
    member_priority,
    proportional::{Boundary, Marginal, MemberPriority},
};

#[derive(Clone, Copy)]
struct Position {
    id: u64,
    cap: u64,
    numerator: u64,
    denominator: u64,
}
impl Position {
    fn lots(self, charge: u64) -> u64 {
        (charge * self.denominator).div_ceil(self.numerator)
    }
    fn priority(self, episode: u64) -> MemberPriority {
        MemberPriority {
            digest: member_priority(&[23; 32], episode, self.id),
            id: self.id,
        }
    }
}

#[test]
fn only_the_exhaustive_optimum_passes_for_every_budget() {
    let mut total = 0;
    for caps in [
        [2, 5, 3],
        [4, 4, 4],
        [0, 3, 3],
        [5, 1, 2],
        [0, 0, 0],
        [1, 1, 1],
    ] {
        for rates in [
            [(1, 1), (1, 1), (1, 1)],
            [(1, 3), (2, 1), (5, 3)],
            [(7, 2), (1, 2), (3, 7)],
        ] {
            let positions: [Position; 3] = core::array::from_fn(|i| Position {
                id: [14, 51, 9991][i],
                cap: caps[i],
                numerator: rates[i].0,
                denominator: rates[i].1,
            });
            let common = caps.iter().map(|&c| c.max(1)).product::<u64>();
            for episode in [9, 10, 11] {
                let mut order = [0, 1, 2];
                order.sort_by_key(|&i| (positions[i].priority(episode).digest, positions[i].id));
                for loss in 0..=caps.iter().sum::<u64>() + 1 {
                    let mut accepted = Vec::new();
                    let mut best = None;
                    for a in 0..=caps[0] {
                        for b in 0..=caps[1] {
                            for c in 0..=caps[2] {
                                let charges = [a, b, c];
                                if a + b + c > loss {
                                    continue;
                                }
                                let score = (
                                    std::cmp::Reverse(a + b + c),
                                    (0..3)
                                        .map(|i| charges[i].pow(2) * common / caps[i].max(1))
                                        .sum::<u64>(),
                                    (0..3).map(|i| positions[i].lots(charges[i])).sum::<u64>(),
                                    std::cmp::Reverse(order.map(|i| charges[i])),
                                );
                                if best.as_ref().is_none_or(|(old, _)| score < *old) {
                                    best = Some((score, charges));
                                }
                                let mut proof = Boundary::default();
                                for &i in &[1, 2, 0] {
                                    let p = positions[i];
                                    proof
                                        .include(
                                            loss,
                                            p.priority(episode),
                                            p.cap,
                                            charges[i],
                                            |k| Some(p.lots(k)),
                                        )
                                        .unwrap();
                                }
                                if proof.complete() {
                                    accepted.push(charges);
                                    let reconstructed = positions.map(|p| {
                                        proof.last_selected.map_or(0, |pivot| {
                                            pivot
                                                .charge(p.cap, p.priority(episode), |k| {
                                                    Some(p.lots(k))
                                                })
                                                .unwrap()
                                        })
                                    });
                                    assert_eq!(reconstructed, charges);
                                }
                                total += 1;
                            }
                        }
                    }
                    assert_eq!(
                        accepted,
                        [best.unwrap().1],
                        "caps={caps:?} episode={episode} loss={loss}"
                    );
                }
            }
        }
    }
    eprintln!("{total} independently scored charge vectors");
}

#[test]
fn a_charge_with_more_than_u64_total_capacity_uses_exact_boundary_products() {
    let member = MemberPriority {
        digest: [2; 32],
        id: 9,
    };
    let p = |unit, capacity| Marginal {
        unit,
        capacity,
        extra_lots: 0,
        member,
    };
    // Both ratios are just below 2. The larger denominator is closer to 2.
    assert!(p(u64::MAX, u64::MAX)
        .compare(&p(u64::MAX - 1, u64::MAX - 1))
        .is_gt());
    let capacity = u64::MAX - 1;
    let mut proof = Boundary::default();
    for id in [1, 2] {
        proof
            .include(
                capacity,
                MemberPriority { id, ..member },
                capacity,
                capacity / 2,
                |k| Some(u64::from(k > 0)),
            )
            .unwrap();
    }
    assert!(proof.complete());
    let saved = proof.clone();
    assert!(proof.include(capacity, member, 0, 1, Some).is_none());
    assert_eq!(proof, saved);
}

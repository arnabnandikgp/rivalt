//! Sufficient whole-market sharing certificates at a fixed recovery total.
//! The linked subset has a separately proved upper bound on total charge.
use crate::proportional::{Boundary, MemberPriority};

#[derive(Clone, Debug, Default)]
pub struct LinkedSharing {
    // Both scans use the same exact marginal deviation cost. The secondary
    // key in one is claimant priority, in the other it is additional lots.
    episode: [Boundary; 2],
    lots: [Boundary; 2],
    winner_lot_sum: u128,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SharingBounds {
    /// This vector minimizes the sum of winners' necessary matched lots
    /// among all minimum-deviation vectors, if certified.
    pub winner_lot_floor: Option<u128>,
}

impl LinkedSharing {
    pub fn include(
        &mut self,
        linked: bool,
        total: u64,
        member: MemberPriority,
        capacity: u64,
        charge: u64,
        matched: impl Fn(u64) -> Option<u64>,
    ) -> Option<()> {
        let index = usize::from(linked);
        let mut episode = self.episode[index].clone();
        let mut lots = self.lots[index].clone();
        episode.include(total, member, capacity, charge, |_| Some(0))?;
        lots.include(total, member, capacity, charge, &matched)?;
        let sum = self
            .winner_lot_sum
            .checked_add(u128::from(matched(charge)?))?;
        self.episode[index] = episode;
        self.lots[index] = lots;
        self.winner_lot_sum = sum;
        Some(())
    }

    pub fn certify(&self, total: u64, linked_cap: u64) -> Option<SharingBounds> {
        let used = self.episode[1].recovered;
        if used > linked_cap || self.episode[0].recovered.checked_add(used)? != total {
            return None;
        }
        let permits_all_exchanges = |groups: &[Boundary; 2]| {
            groups.iter().enumerate().all(|(donor, group)| {
                groups.iter().enumerate().all(|(recipient, other)| {
                    if donor == 0 && recipient == 1 && used == linked_cap {
                        return true;
                    }
                    match (group.last_selected, other.first_remaining) {
                        (Some(last), Some(first)) => !last.compare(&first).is_gt(),
                        _ => true,
                    }
                })
            })
        };
        if !permits_all_exchanges(&self.episode) {
            return None;
        }
        Some(SharingBounds {
            winner_lot_floor: permits_all_exchanges(&self.lots).then_some(self.winner_lot_sum),
        })
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;

    // Compare the certificate with enumeration of all three holders' charges.
    // Integer LCM 60 represents every k^2/weight exactly for weights 1..=5.
    #[test]
    fn compares_all_feasible_exchanges_with_independent_enumeration() {
        for weights in [[2, 3, 4], [4, 4, 4], [5, 1, 3], [1, 1, 1]] {
            let holders = [
                MemberPriority {
                    digest: [1; 32],
                    id: 0,
                },
                MemberPriority {
                    digest: [0; 32],
                    id: 1,
                },
                MemberPriority {
                    digest: [2; 32],
                    id: 2,
                },
            ];
            for mask in 0..8 {
                for total in 0u64..=weights.iter().sum() {
                    for cap in 0..=total {
                        let mut candidates = std::vec::Vec::new();
                        for first in 0..=weights[0] {
                            for second in 0..=weights[1] {
                                let Some(third) = total.checked_sub(first + second) else {
                                    continue;
                                };
                                if third > weights[2] {
                                    continue;
                                }
                                let amounts = [first, second, third];
                                if amounts
                                    .iter()
                                    .enumerate()
                                    .filter(|(i, _)| mask & (1 << i) != 0)
                                    .map(|(_, v)| v)
                                    .sum::<u64>()
                                    > cap
                                {
                                    continue;
                                }
                                let cost = (0..3)
                                    .map(|i| 60 * amounts[i] * amounts[i] / weights[i])
                                    .sum::<u64>();
                                let lots = (0..3)
                                    .map(|i| amounts[i].div_ceil(i as u64 + 1))
                                    .sum::<u64>();
                                candidates.push((amounts, cost, lots));
                            }
                        }
                        let Some(best) = candidates.iter().map(|entry| entry.1).min() else {
                            continue;
                        };
                        let optimal: std::vec::Vec<_> =
                            candidates.iter().filter(|entry| entry.1 == best).collect();
                        let floor = optimal.iter().map(|entry| entry.2).min().unwrap();
                        let earliest = optimal
                            .iter()
                            .map(|entry| [entry.0[1], entry.0[0], entry.0[2]])
                            .max()
                            .unwrap();
                        for (amounts, _, lots) in &candidates {
                            let mut scan = LinkedSharing::default();
                            for i in 0..3 {
                                scan.include(
                                    mask & (1 << i) != 0,
                                    total,
                                    holders[i],
                                    weights[i],
                                    amounts[i],
                                    |n| Some(n.div_ceil(i as u64 + 1)),
                                )
                                .unwrap();
                            }
                            let cert = scan.certify(total, cap);
                            assert_eq!(
                                cert.is_some(),
                                [amounts[1], amounts[0], amounts[2]] == earliest
                            );
                            if let Some(SharingBounds {
                                winner_lot_floor: Some(proven),
                            }) = cert
                            {
                                assert_eq!(proven, u128::from(floor));
                                assert_eq!(*lots, floor);
                            }
                        }
                    }
                }
            }
        }
    }
}

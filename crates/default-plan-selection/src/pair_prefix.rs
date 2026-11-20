//! Necessary capacity bounds for the last D121 comparison, conditional on
//! fixed debtor totals, winner totals and matched lots in one frozen market.

/// A position's remaining atoms and lots. The integer rate is an upper bound
/// on atoms per lot. Debtors use the fastest eligible winner's upper rate.
#[derive(Clone, Copy)]
pub struct Position {
    pub atoms: u64,
    pub lots: u64,
    pub rate: u64,
}

impl Position {
    pub fn minimum_lots(self) -> Option<u64> {
        (self.rate != 0).then(|| self.atoms.div_ceil(self.rate))
    }

    fn available_lots(self, total_floor: u128, remaining_lots: u128) -> Option<u64> {
        let other_floor = total_floor.checked_sub(u128::from(self.minimum_lots()?))?;
        let available = remaining_lots.checked_sub(other_floor)?;
        Some(available.min(u128::from(self.lots)) as u64)
    }
}

#[derive(Clone, Copy, Default)]
pub struct LotBudget {
    pub remaining: u128,
    pub debtor_floor: u128,
    pub winner_floor: u128,
}

impl LotBudget {
    /// If a feasible completion exists, its charge here cannot exceed this
    /// value. An unattained upper bound cannot certify a different candidate.
    pub fn upper_charge(self, debtor: Position, winner: Position) -> Option<u64> {
        let fastest = debtor.rate;
        let rate = winner.rate;
        if rate == 0 || rate > fastest {
            return None;
        }
        let debtor_lots = debtor.available_lots(self.debtor_floor, self.remaining)?;
        let winner_lots = winner.available_lots(self.winner_floor, self.remaining)?;
        if debtor.minimum_lots()? > debtor_lots || winner.minimum_lots()? > winner_lots {
            return None;
        }
        let atoms = debtor.atoms.min(winner.atoms);
        // Even if all 'atoms' change hands here, both endpoints must reserve
        // enough lots to pay the rest after this pair is excluded.
        let mut lots = (debtor_lots - (debtor.atoms - atoms).div_ceil(fastest))
            .min(winner_lots - (winner.atoms - atoms).div_ceil(rate));
        if rate < fastest {
            // Each matched lot here forgoes (fastest - rate) of the debtor's
            // possible capacity elsewhere. The debtor must still pay in full.
            let spare = u128::from(debtor_lots) * u128::from(fastest) - u128::from(debtor.atoms);
            lots = u128::from(lots).min(spare / u128::from(fastest - rate)) as u64;
        }
        Some(u128::from(atoms).min(u128::from(lots) * u128::from(rate)) as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bound_matches_exhaustive_relaxed_pair_capacity() {
        for fastest in 1u64..=5 {
            for rate in 1..=fastest {
                for debt in 0u64..=10 {
                    for gain in 0u64..=10 {
                        for debtor_lots in 0u64..=5 {
                            for winner_lots in 0u64..=5 {
                                let expected = (0..=debt.min(gain)).rev().find(|&charge| {
                                    let matched = charge.div_ceil(rate);
                                    matched + (debt - charge).div_ceil(fastest) <= debtor_lots
                                        && matched + (gain - charge).div_ceil(rate) <= winner_lots
                                });
                                let debtor = Position {
                                    atoms: debt,
                                    lots: debtor_lots,
                                    rate: fastest,
                                };
                                let winner = Position {
                                    atoms: gain,
                                    lots: winner_lots,
                                    rate,
                                };
                                let budget = LotBudget {
                                    remaining: 5,
                                    debtor_floor: u128::from(debt.div_ceil(fastest)),
                                    winner_floor: u128::from(gain.div_ceil(rate)),
                                };
                                assert_eq!(budget.upper_charge(debtor, winner), expected);
                            }
                        }
                    }
                }
            }
        }
    }
}

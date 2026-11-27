//! A protected reduction attaining the lesser of the debtor budget and all
//! available winner capacity is optimal on recovery. Only splits of that total
//! can tie it. Any remaining uninsured impairment still enters final settlement.
use super::*;
use clearing_accounting::attribution::LotRate;
use core::cmp::Reverse;
use default_plan_selection::member_priority;

pub(super) struct Contest {
    pub market: usize,
    pub debtor: usize,
    pub winners: [usize; 2],
    pub budget: u64,
}

impl Contest {
    #[inline(never)]
    pub(super) fn verify(
        &self,
        book: &Book,
        baseline: &Flow,
        pairs: &mut [Pair],
        charges: &mut Columns,
        proof: &RatesProof,
        words: &mut &[u32],
        (venue, capacities): (&Address, &[(usize, usize, FrozenCapacity)]),
    ) -> Result<(Flow, WinnerSplit)> {
        let target = self.market;
        let available = book.rows[self.debtor].cells[target].lots.unsigned_abs();
        let capacity = |winner: usize| -> Result<(u64, LotRate)> {
            let (_, _, terms) = capacities
                .iter()
                .find(|(member, market, _)| *member == winner && *market == target)
                .ok_or(ProofError::DefaultCharge)?;
            let original = book.rows[winner].cells[target].lots.unsigned_abs();
            let rate = checked(terms.lot_rate(original))?;
            Ok((
                terms
                    .eligible
                    .min(checked(rate.capacity(available.min(original)))?),
                rate,
            ))
        };
        let [(left_weight, left_rate), (right_weight, right_rate)] =
            [capacity(self.winners[0])?, capacity(self.winners[1])?];
        require!(
            left_weight > 0 && right_weight > 0,
            ProofError::UnsupportedBook
        );
        let total = self.budget.min(
            left_weight
                .checked_add(right_weight)
                .ok_or(ProofError::DefaultCharge)?,
        );
        charges[target] = total;
        let original_loss_after_charge = baseline.loss[target]
            .checked_sub(
                total
                    .checked_mul(baseline.unit)
                    .ok_or(ProofError::DefaultCharge)?,
            )
            .ok_or(ProofError::DefaultCharge)?;
        let lower = total.saturating_sub(right_weight);
        let upper = total.min(left_weight);
        require!(
            lower <= upper && upper - lower < (PLANS - 1) as u64,
            ProofError::UnsupportedBook
        );
        // Registration fixes roster ordinals. This custody has one terminal episode.
        let keys = self
            .winners
            .map(|member| (member_priority(venue.as_ref(), 1, member as u64), member));
        let preferred = usize::from(keys[1] < keys[0]);
        let mut scratch = Flow::empty(book.rows.len());
        let mut terminal = Flow::empty(book.rows.len());
        let mut best = None;
        let mut selected_split = None;
        for (offset, left) in (lower..=upper).enumerate() {
            let right = total - left;
            let lots = [
                checked(left_rate.matched(left))?,
                checked(right_rate.matched(right))?,
            ];
            if lots[0] + lots[1] > available {
                continue;
            }
            pairs[target].second = Some((self.winners[1], right));
            book.read_plan(words, proof.denominator, pairs, charges, &mut scratch)?;
            if u128::from(scratch.loss[target]) * u128::from(baseline.unit)
                > u128::from(original_loss_after_charge) * u128::from(scratch.unit)
                || book.rank(baseline, &scratch, pairs, charges).is_none()
            {
                continue;
            }
            // At a fixed total, squared proportional deviation is ordered by
            // this absolute cross product. Weights use original eligible gains.
            let deviation = (u128::from(left) * u128::from(right_weight))
                .abs_diff(u128::from(right) * u128::from(left_weight));
            let split = [left, right];
            let rank = (deviation, lots[0] + lots[1], Reverse(split[preferred]));
            let index = offset + 1;
            if best.is_none_or(|(prior, _)| rank < prior) {
                best = Some((rank, index));
            }
            if index == usize::from(proof.selected) {
                selected_split = Some(WinnerSplit {
                    market: 0,
                    members: self.winners.map(|w| w as u8),
                    charges: split,
                    lots,
                });
                core::mem::swap(&mut terminal, &mut scratch);
            }
        }
        require!(words.is_empty(), ProofError::Incomplete);
        require!(
            best.is_some_and(|(_, index)| index == usize::from(proof.selected)),
            ProofError::DefaultCharge
        );
        let split = selected_split.ok_or(ProofError::DefaultCharge)?;
        pairs[target].second = Some((self.winners[1], split.charges[1]));
        Ok((terminal, split))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clearing_accounting::attribution::Attribution;

    #[test]
    fn two_winners_cannot_reuse_the_only_debtor_lot() {
        let rows =
            [(2, -4, -1), (0, 0, -1), (0, 2, 1), (0, 2, 1)].map(|(cash, claim, lots)| Member {
                cash,
                cells: vec![Cell {
                    claim,
                    lots,
                    eligible: claim.max(0) as u32,
                }],
            });
        let terms = Attribution::default()
            .fill(0, 1, 98)
            .unwrap()
            .frozen_capacity(1, 100, 2 * SCALE, 1)
            .unwrap();
        let capacities = [(2, 0, terms.clone()), (3, 0, terms)];
        let mut preferred_members = [false; 2];
        for seed in 0..16 {
            let venue = Address::new_from_array([seed; 32]);
            let preferred = usize::from(
                member_priority(venue.as_ref(), 1, 3) < member_priority(venue.as_ref(), 1, 2),
            );
            preferred_members[preferred] = true;
            let selected = [3, 1][preferred];
            let proof = |choice| RatesProof {
                denominator: 2,
                selected: choice,
                numerators: vec![1, 2, 2],
            };
            let verify =
                |choice| verify_book(&rows, &[0], &proof(choice), Some((&venue, &capacities)));
            let plan = verify(selected).unwrap();
            let (_, split) = plan.split.unwrap();
            assert_eq!(
                (
                    split.charges[preferred],
                    split.lots[preferred],
                    plan.cash[2 + preferred]
                ),
                (2, 1, 0)
            );
            assert_eq!(plan.cash[3 - preferred], 2);
            assert!(verify(4 - selected).is_err()); // equally effective, loses the frozen tie
            assert!(verify(2).is_err()); // splitting one atom each would reuse the same lot
        }
        assert_eq!(preferred_members, [true, true]);
    }
}

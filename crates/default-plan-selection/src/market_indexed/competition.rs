//! Attaining every market's physical recovery bound fixes both the maximum
//! total and the recovery fractions. Only the splits of those totals can tie.
use super::*;
use crate::member_priority;
use clearing_accounting::attribution::LotRate;
use core::cmp::Ordering;

pub(super) struct Contest {
    pub market: usize,
    pub debtor: usize,
    pub first: usize,
    pub second: Option<usize>,
    pub budget: u64,
}

#[derive(Clone, Copy)]
struct Split {
    charges: [u64; 2],
    lots: [u64; 2],
    deviation: u128,
}
struct Dimension {
    market: usize,
    winners: [usize; 2],
    has_second: bool,
    total: u64,
    stride: usize,
    options: Vec<Option<Split>>,
}

impl Contest {
    fn dimension(
        &self,
        book: &Book,
        capacities: &[(usize, usize, FrozenCapacity)],
        stride: usize,
    ) -> Result<Dimension> {
        let available = book.rows[self.debtor].cells[self.market]
            .lots
            .unsigned_abs();
        let capacity = |winner: usize| -> Result<(u64, LotRate)> {
            let (_, _, terms) = capacities
                .iter()
                .find(|(member, market, _)| *member == winner && *market == self.market)
                .ok_or(Error::DefaultCharge)?;
            let original = book.rows[winner].cells[self.market].lots.unsigned_abs();
            let rate = checked(terms.lot_rate(original))?;
            let weight = terms
                .eligible
                .min(checked(rate.capacity(available.min(original)))?);
            require!(weight > 0, Error::UnsupportedBook);
            Ok((weight, rate))
        };
        let (first_weight, first_rate) = capacity(self.first)?;
        let (second_weight, second_rate) = match self.second {
            Some(winner) => capacity(winner)?,
            None => (
                0,
                LotRate {
                    numerator: 0,
                    denominator: 1,
                },
            ),
        };
        let total = self.budget.min(
            first_weight
                .checked_add(second_weight)
                .ok_or(Error::DefaultCharge)?,
        );
        let lower = total.saturating_sub(second_weight);
        let upper = total.min(first_weight);
        require!(
            lower <= upper && upper - lower < (PLANS - 1) as u64,
            Error::UnsupportedBook
        );
        let mut options = Vec::with_capacity((upper - lower + 1) as usize);
        for first in lower..=upper {
            let second = total - first;
            let lots = [
                checked(first_rate.matched(first))?,
                checked(second_rate.matched(second))?,
            ];
            // At fixed weights and total, this orders squared proportional deviation within the market.
            let deviation = (u128::from(first) * u128::from(second_weight))
                .abs_diff(u128::from(second) * u128::from(first_weight));
            options.push((lots[0] + lots[1] <= available).then_some(Split {
                charges: [first, second],
                lots,
                deviation,
            }));
        }
        Ok(Dimension {
            market: self.market,
            winners: [self.first, self.second.unwrap_or(self.first)],
            has_second: self.second.is_some(),
            total,
            stride,
            options,
        })
    }
}

impl Dimension {
    fn choice(&self, index: usize) -> Option<Split> {
        self.options[(index / self.stride) % self.options.len()]
    }
}

fn dominates(dimensions: &[Dimension], a: usize, b: usize) -> bool {
    let mut deviations_equal = true;
    let mut fewer_lots = false;
    let mut more_lots = false;
    for dimension in dimensions {
        // Ranking receives only indices whose physical choices were verified.
        let (first, second) = (dimension.choice(a).unwrap(), dimension.choice(b).unwrap());
        if first.deviation > second.deviation {
            return false;
        }
        deviations_equal &= first.deviation == second.deviation;
        let cost = first
            .lots
            .iter()
            .sum::<u64>()
            .cmp(&second.lots.iter().sum());
        fewer_lots |= cost.is_lt();
        more_lots |= cost.is_gt();
    }
    !deviations_equal || (fewer_lots && !more_lots)
}

fn order(dimensions: &[Dimension], members: &[usize], a: usize, b: usize) -> Result<Ordering> {
    // Incomparable allocations with financially distinct sharing or lot costs
    // need a separate proof. Stable-member priority only resolves financial ties.
    for dimension in dimensions {
        let (first, second) = (dimension.choice(a).unwrap(), dimension.choice(b).unwrap());
        require!(
            first.deviation == second.deviation
                && first.lots.iter().sum::<u64>() == second.lots.iter().sum::<u64>(),
            Error::UnsupportedBook
        );
    }
    for &member in members {
        for dimension in dimensions {
            if let Some(index) = dimension
                .winners
                .iter()
                .position(|&winner| winner == member)
            {
                let choice = dimension.choice(a).unwrap().charges[index]
                    .cmp(&dimension.choice(b).unwrap().charges[index]);
                if !choice.is_eq() {
                    return Ok(choice);
                }
            }
        }
    }
    Ok(Ordering::Equal)
}

#[inline(never)]
pub(super) fn verify(
    contests: &[Contest],
    book: &Book,
    baseline: &Flow,
    pairs: &mut [Pair],
    charges: &mut Columns,
    proof: &RatesProof,
    words: &mut &[u32],
    episode: Episode,
) -> Result<(Flow, Vec<(usize, WinnerSplit)>)> {
    let mut dimensions = Vec::with_capacity(contests.len());
    let mut count = 1;
    for contest in contests {
        let dimension = contest.dimension(book, episode.capacities, count)?;
        count *= dimension.options.len();
        require!(count < PLANS, Error::UnsupportedBook);
        charges[contest.market] = dimension.total;
        dimensions.push(dimension);
    }
    let selected = usize::from(proof.selected)
        .checked_sub(1)
        .ok_or(Error::DefaultCharge)?;
    require!(selected < count, Error::DefaultCharge);
    let mut scratch = Flow::empty(book.rows.len());
    let mut terminal = Flow::empty(book.rows.len());
    let mut contenders = Vec::with_capacity(count);
    for index in 0..count {
        if dimensions
            .iter()
            .any(|dimension| dimension.choice(index).is_none())
        {
            continue;
        }
        for dimension in &dimensions {
            pairs[dimension.market].second = dimension.has_second.then(|| {
                (
                    dimension.winners[1],
                    dimension.choice(index).unwrap().charges[1],
                )
            });
        }
        book.read_plan(words, proof.denominator, pairs, charges, &mut scratch)?;
        let reaches_bound = dimensions.iter().all(|dimension| {
            let market = dimension.market;
            let residual = baseline.loss[market].checked_sub(dimension.total * baseline.unit);
            residual.is_some_and(|loss| {
                u128::from(scratch.loss[market]) * u128::from(baseline.unit)
                    <= u128::from(loss) * u128::from(scratch.unit)
            })
        });
        if reaches_bound && book.rank(baseline, &scratch, pairs, charges).is_some() {
            contenders.push(index);
            if index == selected {
                core::mem::swap(&mut terminal, &mut scratch);
            }
        }
    }
    require!(words.is_empty(), Error::Incomplete);
    require!(
        contenders.contains(&selected)
            && !contenders
                .iter()
                .any(|&other| dominates(&dimensions, other, selected)),
        Error::DefaultCharge
    );
    let mut members: Vec<_> = (0..book.rows.len()).collect();
    members.sort_by_key(|&id| {
        (
            member_priority(episode.venue, episode.ordinal, episode.member_ids[id]),
            episode.member_ids[id],
        )
    });
    for &other in &contenders {
        if other != selected
            && !contenders
                .iter()
                .any(|&rival| dominates(&dimensions, rival, other))
        {
            require!(
                order(&dimensions, &members, selected, other)?.is_gt(),
                Error::DefaultCharge
            );
        }
    }
    let mut receipts = Vec::new();
    for dimension in dimensions {
        let split = dimension.choice(selected).ok_or(Error::DefaultCharge)?;
        if dimension.has_second {
            pairs[dimension.market].second = Some((dimension.winners[1], split.charges[1]));
            receipts.push((
                dimension.market,
                WinnerSplit {
                    members: dimension.winners.map(|m| m as u8),
                    charges: split.charges,
                    lots: split.lots,
                },
            ));
        }
    }
    Ok((terminal, receipts))
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
            let venue = [seed; 32];
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
            let verify = |choice| {
                verify_book(
                    &rows,
                    &[0],
                    &[0],
                    &proof(choice),
                    Some(Episode {
                        venue: &venue,
                        ordinal: 1,
                        member_ids: &[0, 1, 2, 3],
                        capacities: &capacities,
                    }),
                )
            };
            let plan = verify(selected).unwrap();
            let (_, split) = &plan.splits[0];
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

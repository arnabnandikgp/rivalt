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
            lower <= upper && upper - lower < PLANS as u64,
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
            options.push(
                (lots[0]
                    .checked_add(lots[1])
                    .is_some_and(|total| total <= available))
                .then_some(Split {
                    charges: [first, second],
                    lots,
                    deviation,
                }),
            );
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

fn set_splits(dimensions: &[Dimension], pairs: &mut [Pair], index: usize) {
    for dimension in dimensions {
        pairs[dimension.market].second = dimension.has_second.then(|| {
            (
                dimension.winners[1],
                dimension.choice(index).unwrap().charges[1],
            )
        });
    }
}
/// A different multiset of original creditor/debtor rows proves that the two
/// markets cannot be interchanged by renumbering members. Flat listing columns
/// alone do not turn an existing two-market symmetry into a new financial tie.
fn distinct_markets(book: &Book, dimensions: &[Dimension]) -> bool {
    let target = |market| {
        dimensions
            .iter()
            .any(|dimension| dimension.market == market)
    };
    let same_row = |first: usize, second: usize, left: usize, right: usize| {
        let a = &book.rows[first];
        let b = &book.rows[second];
        a.cash == b.cash
            && a.cells[left].claim == b.cells[right].claim
            && a.cells[left].lots == b.cells[right].lots
            && a.cells[left].eligible == b.cells[right].eligible
            && (0..book.width)
                .filter(|&m| !target(m))
                .all(|m| a.cells[m].claim == b.cells[m].claim && a.cells[m].lots == b.cells[m].lots)
    };
    for (index, left) in dimensions.iter().enumerate() {
        for right in &dimensions[index + 1..] {
            if book.reserves[left.market] != book.reserves[right.market]
                || book.pools[left.market] != book.pools[right.market]
            {
                continue;
            }
            let mut available = [true; MEMBERS];
            let reflected = (0..book.rows.len()).all(|a| {
                if let Some(b) = (0..book.rows.len())
                    .find(|&b| available[b] && same_row(a, b, left.market, right.market))
                {
                    available[b] = false;
                    true
                } else {
                    false
                }
            });
            if reflected {
                return false;
            }
        }
    }
    true
}
fn market_order(episode: Episode, dimensions: &[Dimension]) -> Vec<usize> {
    let mut markets: Vec<_> = (0..dimensions.len()).collect();
    markets.sort_by_key(|&m| {
        let id = episode.market_ids[dimensions[m].market];
        (
            solana_sha256_hasher::hashv(&[
                b"Rivalt/frozen-market-order/v1\0",
                episode.venue,
                &episode.ordinal.to_le_bytes(),
                &id.to_le_bytes(),
            ])
            .to_bytes(),
            id,
        )
    });
    markets
}
fn order(
    dimensions: &[Dimension],
    members: &[usize],
    markets: &[usize],
    wider: bool,
    a: usize,
    b: usize,
) -> Result<Ordering> {
    // Among the undominated plans, a strict difference here means that neither
    // proportional allocation is better in every market. Total costs and
    // insurance have already been checked before using the frozen order.
    for &market in markets {
        let dimension = &dimensions[market];
        let priority = dimension
            .choice(b)
            .unwrap()
            .deviation
            .cmp(&dimension.choice(a).unwrap().deviation);
        if !priority.is_eq() {
            require!(wider, Error::UnsupportedBook);
            return Ok(priority);
        }
    }
    for dimension in dimensions {
        require!(
            dimension.choice(a).unwrap().lots.iter().sum::<u64>()
                == dimension.choice(b).unwrap().lots.iter().sum::<u64>(),
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
) -> Result<(Flow, Vec<(usize, WinnerSplit)>, usize, usize)> {
    let mut dimensions = Vec::with_capacity(contests.len());
    let mut count = 1;
    for contest in contests {
        let dimension = contest.dimension(book, episode.capacities, count)?;
        count *= dimension.options.len();
        require!(count <= PLANS, Error::UnsupportedBook);
        charges[contest.market] = dimension.total;
        dimensions.push(dimension);
    }
    let selected = usize::from(proof.selected)
        .checked_sub(1)
        .ok_or(Error::DefaultCharge)?;
    require!(selected < count, Error::DefaultCharge);
    let mut scratch = Flow::empty(book.rows.len());
    let mut terminal = Flow::empty(book.rows.len());
    let mut checked_plans = 1; // Includes the baseline.
    let mut selected_ordinal = 0;
    let mut contenders = Vec::with_capacity(count);
    let mut witnesses = vec![&[][..]; count];
    for index in 0..count {
        if dimensions
            .iter()
            .any(|dimension| dimension.choice(index).is_none())
        {
            continue;
        }
        set_splits(&dimensions, pairs, index);
        if index == selected {
            selected_ordinal = checked_plans;
        }
        checked_plans += 1;
        let input = *words;
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
            witnesses[index] = &input[..input.len() - words.len()];
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
    let finalists: Vec<_> = contenders
        .iter()
        .copied()
        .filter(|&candidate| {
            !contenders
                .iter()
                .any(|&rival| dominates(&dimensions, rival, candidate))
        })
        .collect();
    let contested_sharing = finalists.iter().any(|&other| {
        dimensions
            .iter()
            .any(|d| d.choice(selected).unwrap().deviation != d.choice(other).unwrap().deviation)
    });
    let mut markets: Vec<_> = (0..dimensions.len()).collect();
    if contested_sharing {
        require!(
            book.width >= 3 && distinct_markets(book, &dimensions),
            Error::UnsupportedBook
        );
        markets = market_order(episode, &dimensions);
        let lots_closed = |index| {
            dimensions
                .iter()
                .map(|d| u128::from(d.choice(index).unwrap().lots.iter().sum::<u64>()))
                .sum::<u128>()
        };
        let lots = lots_closed(selected);
        // Only finalists require a second pass. A missing integer protection
        // proof refuses this class of book instead of excluding a competing plan.
        for &index in &finalists {
            require!(lots_closed(index) == lots, Error::UnsupportedBook);
            set_splits(&dimensions, pairs, index);
            if index == selected {
                protected_cash(book.rows, baseline, &terminal, pairs, charges)?;
            } else {
                let mut witness = witnesses[index];
                book.read_plan(
                    &mut witness,
                    proof.denominator,
                    pairs,
                    charges,
                    &mut scratch,
                )?;
                require!(
                    witness.is_empty() && scratch.spent == terminal.spent,
                    Error::UnsupportedBook
                );
                protected_cash(book.rows, baseline, &scratch, pairs, charges)?;
            }
        }
    }
    for other in finalists {
        if other != selected {
            require!(
                order(
                    &dimensions,
                    &members,
                    &markets,
                    contested_sharing,
                    selected,
                    other
                )?
                .is_gt(),
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
    Ok((terminal, receipts, selected_ordinal, checked_plans))
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
                        market_ids: &[0],
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
    #[test]
    fn asymmetric_finalists_follow_the_frozen_market_order() {
        let frozen = [
            (7, [-11, 0, 0], [-2, 0, 0]),
            (7, [0, -11, 0], [0, -2, 0]),
            (0, [3, 0, 0], [1, 0, 0]),
            (0, [0, 3, 0], [0, 1, 0]),
            (0, [4, -4, 0], [1, 0, 0]),
            (0, [-4, 4, 0], [0, 1, 0]),
            (0, [8, 0, 2], [0; 3]),
            (0, [0, 8, 0], [0; 3]),
            (2, [0, 0, -2], [0; 3]),
        ];
        let mut capacities = Vec::new();
        let rows: Vec<_> = frozen
            .iter()
            .enumerate()
            .map(|(member, &(cash, claims, lots))| {
                let cells = (0..3)
                    .map(|market| {
                        let gain = if lots[market] > 0 {
                            claims[market] as u32
                        } else {
                            0
                        };
                        if gain > 0 {
                            let capacity = Attribution::default()
                                .fill(0, 1, 100 - u64::from(gain))
                                .unwrap()
                                .frozen_capacity(1, 100, i128::from(gain) * SCALE, 1)
                                .unwrap();
                            capacities.push((member, market, capacity));
                        }
                        Cell {
                            claim: claims[market],
                            lots: lots[market],
                            eligible: gain,
                        }
                    })
                    .collect();
                Member { cash, cells }
            })
            .collect();
        // Denominator, BTC, ETH, SOL rates for the baseline and sixteen full-bound splits.
        // The exact-fraction reference enumerates all 100 original plans including smaller charges.
        let numerators = vec![
            11, 8, 8, 11, 11, 8, 8, 11, 71, 52, 56, 71, 141, 104, 120, 141, 35, 26, 32, 35, 71, 56,
            52, 71, 5, 4, 4, 5, 69, 56, 60, 69, 17, 14, 16, 17, 141, 120, 104, 141, 69, 60, 56, 69,
            9, 8, 8, 9, 33, 30, 32, 33, 35, 32, 26, 35, 17, 16, 14, 17, 33, 32, 30, 33, 1, 1, 1, 1,
        ];
        for (epoch, winner, cash) in [
            (1, 15, [0, 0, 1, 0, 0, 0, 9, 8, 0]),
            (2, 12, [0, 0, 0, 1, 0, 0, 10, 7, 0]),
        ] {
            let verify = |selected| {
                verify_book(
                    &rows,
                    &[0; 3],
                    &[1, 1, 0],
                    &RatesProof {
                        denominator: 0,
                        selected,
                        numerators: numerators.clone(),
                    },
                    Some(Episode {
                        venue: &[0; 32],
                        ordinal: epoch,
                        member_ids: &[100, 101, 102, 103, 104, 105, 106, 107, 108],
                        market_ids: &[13, 18, 23],
                        capacities: &capacities,
                    }),
                )
            };
            for proposed in 1..=16 {
                if proposed == winner {
                    let result = verify(proposed).unwrap();
                    assert_eq!(result.cash, cash);
                    assert_eq!(&result.spent[..3], &[1, 1, 0]);
                    assert_eq!(&result.charges[..3], &[3, 3, 0]);
                    assert_eq!(
                        result.splits.iter().flat_map(|(_, s)| s.lots).sum::<u64>(),
                        3
                    );
                } else {
                    assert!(
                        verify(proposed).is_err(),
                        "episode {epoch} accepted proposal {proposed}"
                    );
                }
            }
        }
    }
}

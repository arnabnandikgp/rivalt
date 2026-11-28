//! Exact specialization for one BTC debtor, a cross winner, a second BTC creditor,
//! and two isolated foreign creditors. Derive the bound before accepting any charge.
use super::*;
use clearing_accounting::{attribution::FrozenCapacity, entry_cost::EntryCost};
use default_plan_selection::member_priority;
use financial_core::SCALE;

pub(super) struct Outcome {
    pub cash: [u64; MEMBERS],
    pub charges: Charges,
    pub matched: u64,
}

#[derive(PartialEq, Eq)]
pub enum Charges {
    Single(u64),
    Competing([u64; 2]),
}

impl Charges {
    pub(super) fn total(&self) -> Result<u64> {
        match *self {
            Self::Single(charge) => Ok(charge),
            Self::Competing([first, second]) => checked(financial_core::cash_add(first, second)),
        }
    }
}

struct Distribution {
    charges: Charges,
    matched: u64,
    second_receipt: u64,
}

fn capacity(entry: &EntryCost, lots: i64, price: u64, claim: i128) -> Result<FrozenCapacity> {
    checked(checked(entry.frozen_basis(lots))?.frozen_capacity(
        lots,
        price,
        claim * SCALE,
        lots.unsigned_abs(),
    ))
}

fn single_distribution(
    capacity: &FrozenCapacity,
    debt: u64,
    funded: u64,
    second_claim: u64,
    protected: u128,
) -> Result<Distribution> {
    let charge = protected
        .min(u128::from(debt - funded))
        .min(u128::from(capacity.eligible)) as u64;
    require!(charge > 0, ProofError::UnsupportedBook);
    let remaining = u128::from(debt - charge);
    let payment = u128::from(funded) * u128::from(second_claim);
    require!(payment % remaining == 0, ProofError::UnsupportedBook);
    Ok(Distribution {
        charges: Charges::Single(charge),
        matched: checked(capacity.schedule(charge))?.matched,
        second_receipt: (payment / remaining) as u64,
    })
}

// At full recovery the remaining BTC claims pay at par. The cross creditor must
// retain the entire gap in foreign cash. Intersect that bound with both position
// capacities, then rank the two closest integer splits to the proportional ideal.
fn competing_distribution(
    capacities: &[FrozenCapacity; 2],
    total: u64,
    protected_maximum: u64,
    second_claim: u64,
    venue: &Address,
    slot: u64,
) -> Result<Distribution> {
    let [left, right] = capacities.each_ref().map(|c| c.eligible);
    require!(left > 0 && right > 0, ProofError::UnsupportedBook);
    let minimum = total.saturating_sub(right);
    let maximum = total.min(left).min(protected_maximum);
    require!(minimum <= maximum, ProofError::UnsupportedBook);
    let numerator = u128::from(total) * u128::from(left);
    let denominator = u128::from(left) + u128::from(right);
    let floor = ((numerator / denominator) as u64).clamp(minimum, maximum);
    let ceil = (numerator.div_ceil(denominator) as u64).clamp(minimum, maximum);
    let evaluate = |first: u64| -> Result<_> {
        let second = total - first;
        let deviation =
            (u128::from(first) * u128::from(right)).abs_diff(u128::from(second) * u128::from(left));
        let first_lots = checked(capacities[0].schedule(first))?.matched;
        let second_lots = checked(capacities[1].schedule(second))?.matched;
        let matched = first_lots
            .checked_add(second_lots)
            .ok_or(ProofError::UnsupportedBook)?;
        Ok((deviation, matched))
    };
    let floor_rank = evaluate(floor)?;
    let (first, matched) = if ceil == floor {
        (floor, floor_rank.1)
    } else {
        let ceil_rank = evaluate(ceil)?;
        let prefer_first = || {
            (member_priority(venue.as_ref(), slot, 0), 0)
                < (member_priority(venue.as_ref(), slot, 2), 2)
        };
        if ceil_rank < floor_rank || (ceil_rank == floor_rank && prefer_first()) {
            (ceil, ceil_rank.1)
        } else {
            (floor, floor_rank.1)
        }
    };
    let second = total - first;
    Ok(Distribution {
        charges: Charges::Competing([first, second]),
        matched,
        second_receipt: second_claim - second,
    })
}

fn atoms(value: i128) -> Result<u64> {
    u64::try_from(value).map_err(|_| ProofError::UnsupportedBook.into())
}

pub(super) fn plan(book: &Book, venue: &Address, slot: u64) -> Result<Outcome> {
    let mut claims = [[0i128; MARKETS]; MEMBERS];
    let mut lots = [[0i64; MARKETS]; MEMBERS];
    let mut entries = [EntryCost::default(); 2];
    for (member, root) in book.roots.iter().enumerate() {
        let expected_mode = [
            CROSS,
            book.markets[0].id,
            book.markets[0].id,
            book.markets[1].id,
            book.markets[2].id,
        ][member];
        require!(root.isolated == expected_mode, ProofError::DefaultRoster);
        let mut previous = None;
        for slot in &root.slots {
            let (_, image) = slot.decode()?;
            let market = book
                .markets
                .iter()
                .position(|m| m.id == image.market)
                .ok_or(ProofError::DefaultRoster)?;
            require!(
                previous.is_none_or(|index| index < market)
                    && (member == 0 || root.isolated == image.market),
                ProofError::DefaultRoster
            );
            previous = Some(market);
            let price = &book.markets[market];
            let claim = checked(image.position.unpaid(price.price, price.funding))?;
            require!(claim % SCALE == 0, ProofError::UnsupportedBook);
            claims[member][market] = claim / SCALE;
            lots[member][market] = image.position.lots;
            if market == 0 && (member == 0 || member == 2) {
                entries[member / 2] = image.entry;
            }
        }
    }
    for market in 0..MARKETS {
        require!(
            claims.iter().map(|row| row[market]).sum::<i128>() == 0
                && lots.iter().map(|row| i128::from(row[market])).sum::<i128>() == 0,
            ProofError::UnsupportedBook
        );
    }
    require!(
        lots[0][0] != 0 && (lots[2][0] == 0 || lots[2][0].signum() == lots[0][0].signum()),
        ProofError::UnsupportedBook
    );
    let debt = atoms(-claims[1][0])?;
    let gain = atoms(claims[0][0])?;
    let second_claim = atoms(claims[2][0])?;
    let eth = atoms(claims[3][1])?;
    let sol = atoms(claims[4][2])?;
    require!(
        debt > 0 && second_claim > 0 && gain > 0 && eth > 0 && sol > 0,
        ProofError::UnsupportedBook
    );
    let funded = checked(financial_core::cash_add(
        book.roots[1].cash,
        book.markets[0].insurance,
    ))?;
    let foreign = u128::from(eth) + u128::from(sol);
    let gap = foreign
        .checked_sub(u128::from(book.roots[0].cash))
        .ok_or(ProofError::UnsupportedBook)?;
    require!(
        funded < debt && gap > 0 && gap < u128::from(funded),
        ProofError::UnsupportedBook
    );

    // The cross winner receives funded * gain / debt before forced closes.
    // Restrict this certificate to books whose foreign claims are covered in
    // full at baseline without spending either foreign insurance reserve.
    let available = u128::from(funded) * u128::from(gain);
    let required = gap * u128::from(debt);
    require!(available >= required, ProofError::UnsupportedBook);
    let first = capacity(&entries[0], lots[0][0], book.markets[0].price, claims[0][0])?;
    let distribution = if lots[2][0] == 0 {
        // For a single charge x the cross receipt is funded * (gain-x) / (debt-x).
        let protected = (available - required) / (u128::from(funded) - gap);
        single_distribution(&first, debt, funded, second_claim, protected)?
    } else {
        let second = capacity(&entries[1], lots[2][0], book.markets[0].price, claims[2][0])?;
        // Both winners have the same sign and their lots sum to the debtor's
        // opposite inventory. Each individual schedule fits its original lots.
        competing_distribution(
            &[first, second],
            debt - funded,
            gain - gap as u64,
            second_claim,
            venue,
            slot,
        )?
    };
    let winner_cash = u128::from(funded)
        .checked_sub(u128::from(distribution.second_receipt) + gap)
        .ok_or(ProofError::UnsupportedBook)?;
    let cash = [
        u64::try_from(winner_cash).map_err(|_| ProofError::UnsupportedBook)?,
        0,
        checked(financial_core::cash_add(
            book.roots[2].cash,
            distribution.second_receipt,
        ))?,
        checked(financial_core::cash_add(book.roots[3].cash, eth))?,
        checked(financial_core::cash_add(book.roots[4].cash, sol))?,
    ];
    let retained: u128 = book.markets.iter().map(|m| u128::from(m.retained)).sum();
    let foreign_reserves =
        u128::from(book.markets[1].insurance) + u128::from(book.markets[2].insurance);
    require!(
        cash.iter().map(|&v| u128::from(v)).sum::<u128>() + retained + foreign_reserves
            == u128::from(book.allocated),
        ProofError::UnsupportedBook
    );
    Ok(Outcome {
        cash,
        charges: distribution.charges,
        matched: distribution.matched,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cmp::Reverse;

    #[test]
    fn protected_interval_matches_exhaustive_charge_and_lot_ranking() {
        let venue = Address::new_from_array([7; 32]);
        // These lots can each concede at most 3 and 2 ticks respectively.
        for (left, right) in [(6, 6), (6, 4), (3, 6)] {
            let capacities = [
                capacity(&EntryCost::default().fill(0, 2, 194).unwrap(), 2, 100, i128::from(left)).unwrap(),
                capacity(&EntryCost::default().fill(0, 3, 294).unwrap(), 3, 100, i128::from(right)).unwrap(),
            ];
            for slot in 0..4 {
                let first_precedes = member_priority(venue.as_ref(), slot, 0)
                    <= member_priority(venue.as_ref(), slot, 2);
                for total in 1u64..=13 {
                    for protected in 0..=6 {
                        let best = (0..=total)
                            .filter(|&a| a <= protected && a <= left && total - a <= right)
                            .min_by_key(|&a| {
                                let b = total - a;
                                (
                                    (a * right).abs_diff(b * left),
                                    a.div_ceil(3) + b.div_ceil(2),
                                    Reverse(if first_precedes { a } else { b }),
                                )
                            });
                        let actual =
                            competing_distribution(&capacities, total, protected, right, &venue, slot);
                        if let Some(first) = best {
                            let result = actual.unwrap();
                            assert!(result.charges == Charges::Competing([first, total - first]));
                            assert_eq!(
                                result.matched,
                                first.div_ceil(3) + (total - first).div_ceil(2)
                            );
                            assert_eq!(result.second_receipt, right - (total - first));
                        } else {
                            assert!(actual.is_err());
                        }
                    }
                }
            }
        }
    }
}

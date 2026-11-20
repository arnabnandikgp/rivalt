//! Compare only candidates tied at the greatest D120 score. No charge ordering
//! can compensate for a worse proportional split, extra lots, or foreign loss.
use super::alloc::{collections::BTreeMap, vec, vec::Vec};
use super::{Edge, Ratio};
use crate::{
    joint::{Charge, FrozenBook, Receipt},
    member_priority, mirror,
};
use clearing_accounting::attribution::Attribution;
use core::cmp::Ordering;
use financial_core::{Error, Result, SCALE};
use num_bigint::BigInt;

pub struct FrozenPriority<'a> {
    pub venue: &'a [u8; 32],
    pub episode: u64,
    /// A keeper may propose alternative involutions. Each used map must match
    /// every frozen member, both adjusted outcomes and every paired fill.
    pub reflections: &'a [Vec<usize>],
}
#[derive(PartialEq, Eq)]
struct Profile {
    deviation: [Ratio; 2],
    cost: [(u128, u128); 2],
}
impl Profile {
    fn dominates(&self, other: &Self) -> bool {
        if self.deviation != other.deviation {
            return (0..2).all(|market| {
                !self.deviation[market]
                    .compare(&other.deviation[market])
                    .is_gt()
            });
        }
        self.cost != other.cost && (0..2).all(|market| self.cost[market] <= other.cost[market])
    }
}
struct Finalist<'a> {
    charges: &'a [Charge],
    receipt: Receipt,
    profile: Profile,
    totals: Vec<[u64; 2]>,
    claims: Vec<[i128; 2]>,
    pairs: Vec<mirror::Pair<[u64; 3]>>,
    member_order: Vec<[u64; 2]>,
    pair_order: BTreeMap<(usize, usize, usize), u64>,
}
impl Finalist<'_> {
    fn priority(&self, other: &Self) -> Ordering {
        self.member_order.cmp(&other.member_order).then_with(|| {
            // Compare the sparse pair charge vectors at the earliest differing key.
            self.pair_order
                .keys()
                .chain(other.pair_order.keys())
                .filter_map(|key| {
                    let order = self
                        .pair_order
                        .get(key)
                        .unwrap_or(&0)
                        .cmp(other.pair_order.get(key).unwrap_or(&0));
                    (!order.is_eq()).then_some((key, order))
                })
                .min_by_key(|&(key, _)| key)
                .map_or(Ordering::Equal, |(_, order)| order)
        })
    }
}
fn index(book: &FrozenBook<'_>, id: u64) -> Result<usize> {
    book.members
        .binary_search_by_key(&id, |market| market.id)
        .map_err(|_| Error::Cohort)
}
fn finalist<'a>(
    book: &FrozenBook<'_>,
    charges: &'a [Charge],
    receipt: Receipt,
    weights: &[[u64; 2]],
    ranks: &[usize],
) -> Result<Finalist<'a>> {
    let mut totals = vec![[0u64; 2]; book.members.len()];
    let mut claims: Vec<_> = book
        .members
        .iter()
        .map(|market| market.row.claims)
        .collect();
    let mut cost = [(0u128, 0u128); 2];
    let mut pairs = Vec::new();
    let mut pair_order = BTreeMap::new();
    for (charge, fill) in charges.iter().zip(&receipt.fills) {
        let market = charge.market;
        let winner = index(book, charge.winner)?;
        let debtor = index(book, charge.debtor)?;
        totals[winner][market] = totals[winner][market]
            .checked_add(charge.atoms)
            .ok_or(Error::Overflow)?;
        let delta = i128::from(charge.atoms) * SCALE;
        claims[winner][market] -= delta;
        claims[debtor][market] += delta;
        cost[market].0 += u128::from(charge.atoms);
        cost[market].1 += u128::from(fill.matched);
        pairs.push(mirror::Pair {
            market: market as u8,
            winner,
            debtor,
            charge: charge.atoms,
            fills: [fill.matched, fill.base_ticks, fill.extra_tick_lots],
        });
        pair_order.insert((ranks[winner], market, ranks[debtor]), charge.atoms);
    }
    pairs.sort_by_key(|plan| (plan.winner, plan.market, plan.debtor));
    let deviation = core::array::from_fn(|market| {
        let mut sum = Ratio(0.into(), 1u8.into());
        let mut weight = 0u128;
        for (member, cap) in weights.iter().enumerate().filter(|(_, w)| w[market] > 0) {
            let charged = BigInt::from(totals[member][market]);
            weight += u128::from(cap[market]);
            sum = sum
                .sum(&Ratio(&charged * &charged, cap[market].into()))
                .reduced();
        }
        if weight == 0 {
            return sum;
        }
        let total = BigInt::from(cost[market].0);
        sum.sum(&Ratio(-(&total * &total), weight.into())).reduced()
    });
    let mut member_order = totals.clone();
    for (ordinal, &rank) in ranks.iter().enumerate() {
        member_order[rank] = totals[ordinal];
    }
    Ok(Finalist {
        charges,
        receipt,
        profile: Profile { deviation, cost },
        totals,
        claims,
        pairs,
        member_order,
        pair_order,
    })
}

fn rate(receipt: &Receipt, market: usize) -> Ratio {
    let (numerator, denominator) = &receipt.market_rates[market];
    Ratio(numerator.clone().into(), denominator.clone())
}
fn reflected(
    book: &FrozenBook<'_>,
    base: &Receipt,
    plans: [&Finalist<'_>; 2],
    priority: &FrozenPriority<'_>,
) -> Result<bool> {
    let [first, second] = plans;
    let frozen = core::array::from_fn(|market| {
        (
            book.marks[market],
            book.insurance[market],
            book.fees[market],
            book.pools[market],
            rate(base, market),
            base.effective_budgets[market],
            base.spent[market],
        )
    });
    let outcomes = plans.map(|plan| {
        core::array::from_fn(|market| {
            let (numerator, denominator) = &plan.receipt.recovered[market];
            (
                Ratio(numerator.clone(), denominator.clone()),
                plan.profile.deviation[market].clone(),
                plan.profile.cost[market],
                rate(&plan.receipt, market),
                plan.receipt.effective_budgets[market],
                plan.receipt.spent[market],
            )
        })
    });
    let recovery_and_insurance = plans.map(|plan| {
        core::array::from_fn(|market| {
            (
                plan.receipt.recovered[market].clone(),
                plan.receipt.spent[market],
            )
        })
    });
    let markets = mirror::Markets {
        frozen,
        outcomes,
        recovery_and_insurance,
    };
    let mut members = Vec::with_capacity(book.members.len());
    for (ordinal, member) in book.members.iter().enumerate() {
        // With identical starting cash, both claims, adjusted claims and greatest
        // rates, exact collections and payouts follow uniquely. Rounded receipts
        // still require a per-member comparison because row identity breaks ties.
        let position = |market: usize| -> Result<_> {
            Ok((
                member.row.cash,
                member.row.claims[market],
                member.lots[market],
                Attribution::read(member.history[market], member.lots[market])?,
                base.rounded.cash[ordinal],
                base.rounded.movements[ordinal][market],
            ))
        };
        members.push(mirror::Member {
            id: member.id,
            frozen: [position(0)?, position(1)?],
            outcomes: plans.map(|plan| {
                core::array::from_fn(|market| {
                    (
                        plan.claims[ordinal][market],
                        plan.receipt.remaining_lots[ordinal][market],
                        plan.receipt.rounded.cash[ordinal],
                        plan.receipt.rounded.movements[ordinal][market],
                    )
                })
            }),
            charges: plans.map(|plan| plan.totals[ordinal]),
        });
    }
    Ok(priority.reflections.iter().any(|map| {
        mirror::compare(
            priority.venue,
            priority.episode,
            &markets,
            &members,
            map,
            [&first.pairs, &second.pairs],
        ) == Some(Ordering::Greater)
    }))
}

pub(super) fn weights(book: &FrozenBook<'_>, edges: &[Edge]) -> Result<Vec<[u64; 2]>> {
    let mut pairable = vec![[0u64; 2]; book.members.len()];
    for edge in edges {
        let lots = &mut pairable[edge.winner][edge.market];
        *lots = lots
            .saturating_add(book.members[edge.debtor].lots[edge.market].unsigned_abs())
            .min(book.members[edge.winner].lots[edge.market].unsigned_abs());
    }
    book.members
        .iter()
        .zip(pairable)
        .map(|(member, lots)| {
            Ok([
                book.capacity(member, 0, lots[0])?.eligible,
                book.capacity(member, 1, lots[1])?.eligible,
            ])
        })
        .collect()
}

pub(super) fn select(
    book: &FrozenBook<'_>,
    baseline: &Receipt,
    edges: &[Edge],
    choices: &[Vec<Charge>],
    priority: FrozenPriority<'_>,
    mut verify: impl FnMut(&[Charge]) -> Result<Receipt>,
) -> Result<Option<Vec<Charge>>> {
    let weights = weights(book, edges)?;
    let mut order: Vec<_> = (0..book.members.len()).collect();
    order.sort_by_key(|&ordinal| {
        let id = book.members[ordinal].id;
        (member_priority(priority.venue, priority.episode, id), id)
    });
    let mut ranks = vec![0; order.len()];
    for (rank, ordinal) in order.into_iter().enumerate() {
        ranks[ordinal] = rank;
    }
    let mut plans = Vec::new();
    for charges in choices {
        plans.push(finalist(book, charges, verify(charges)?, &weights, &ranks)?);
    }
    let survivors: Vec<_> = plans
        .iter()
        .filter(|plan| {
            !plans
                .iter()
                .any(|other| other.profile.dominates(&plan.profile))
        })
        .collect();
    let best = survivors
        .iter()
        .copied()
        .max_by(|a, b| a.priority(b))
        .ok_or(Error::Invariant)?;
    for other in survivors {
        if other.profile != best.profile && !reflected(book, baseline, [best, other], &priority)? {
            return Ok(None);
        }
    }
    Ok(Some(best.charges.to_vec()))
}

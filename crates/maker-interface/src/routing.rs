//! Select an ordinary full-size order from three registered canonical curves.
//! Price bounds prune splits. Only the caller's financial admission can accept one.
use crate::canonical::{ExecutionCurve, MAX_DEPTH};
use crate::{QuoteError, QuoteResult};
use financial_core::{fee_total, price_policy, MIN_ORDER_ATOMS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Allocation {
    /// Quantities and gross amounts in sealed registration order.
    pub lots: [u64; 3],
    pub amounts: [u64; 3],
    pub gross: u64,
    pub fee: u64,
    pub all_in: u64,
}

impl Allocation {
    fn new(side: u8, lots: [u64; 3], amounts: [u64; 3]) -> QuoteResult<Self> {
        let gross = amounts
            .iter()
            .try_fold(0u64, |sum, amount| sum.checked_add(*amount))
            .ok_or(QuoteError::Arithmetic)?;
        let fee = fee_total(gross).map_err(|_| QuoteError::Arithmetic)?;
        let all_in = if side == 0 {
            gross.checked_add(fee)
        } else {
            gross.checked_sub(fee)
        }
        .ok_or(QuoteError::Arithmetic)?;
        Ok(Self {
            lots,
            amounts,
            gross,
            fee,
            all_in,
        })
    }

    fn better(self, previous: Self, side: u8) -> bool {
        if self.all_in != previous.all_in {
            return if side == 0 {
                self.all_in < previous.all_in
            } else {
                self.all_in > previous.all_in
            };
        }
        let current = self.lots.map(|quantity| quantity != 0);
        let previous_makers = previous.lots.map(|quantity| quantity != 0);
        let count = |used: [bool; 3]| used.into_iter().filter(|present| *present).count();
        // For equal leg counts, a true bit at the first difference selects the
        // smaller instance ID. For identical IDs prefer more lots on the first.
        match count(current).cmp(&count(previous_makers)) {
            std::cmp::Ordering::Less => true,
            std::cmp::Ordering::Greater => false,
            std::cmp::Ordering::Equal if current != previous_makers => current > previous_makers,
            std::cmp::Ordering::Equal => self.lots > previous.lots,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Order {
    pub side: u8,
    pub lots: u64,
    pub reference: u64,
    pub all_in_limit: u64,
    pub max_fee: u64,
}

impl Order {
    fn within_limit(self, all_in: u64) -> bool {
        if self.side == 0 {
            all_in <= self.all_in_limit
        } else {
            all_in >= self.all_in_limit
        }
    }
}

/// First true in an ascending predicate, or end+1 if none. Quantities are
/// already bounded by MAX_DEPTH, including all one-past-end sentinels.
fn first_true(
    mut start: u64,
    end: u64,
    mut test: impl FnMut(u64) -> QuoteResult<bool>,
) -> QuoteResult<u64> {
    if start > end || test(start)? {
        return Ok(start);
    }
    if start == end || !test(end)? {
        return Ok(end + 1);
    }
    start += 1;
    let mut stop = end;
    while start < stop {
        let middle = start + (stop - start) / 2;
        if test(middle)? {
            stop = middle;
        } else {
            start = middle + 1;
        }
    }
    Ok(start)
}

/// Marginal prices are monotone. Valid endpoint prices form a prefix and the
/// intersection of the two average-price bands is one interval. Neither
/// property is assumed for maker margin, trader margin or gross-lot headroom.
fn price_domain(curve: ExecutionCurve, order: Order) -> QuoteResult<(u64, u64)> {
    if curve.side() != order.side {
        return Err(QuoteError::Binding);
    }
    let available = curve.capacity()?.min(order.lots);
    let upper = first_true(1, available, |quantity| match curve.gross(quantity) {
        Ok(_) => Ok(false),
        Err(QuoteError::Bounds) => Ok(true),
        Err(error) => Err(error),
    })? - 1;
    let relative = |quantity, multiplier| -> QuoteResult<std::cmp::Ordering> {
        let gross =
            u128::from(curve.gross(quantity)?) * u128::from(price_policy::EXECUTION_DENOMINATOR);
        let boundary = u128::from(order.reference) * u128::from(quantity) * u128::from(multiplier);
        Ok(gross.cmp(&boundary))
    };
    let lower_band = price_policy::EXECUTION_LOWER_NUMERATOR;
    let upper_band = price_policy::EXECUTION_UPPER_NUMERATOR;
    if order.side == 0 {
        Ok((
            first_true(1, upper, |quantity| {
                Ok(!relative(quantity, lower_band)?.is_lt())
            })?,
            first_true(1, upper, |quantity| {
                Ok(relative(quantity, upper_band)?.is_gt())
            })? - 1,
        ))
    } else {
        Ok((
            first_true(1, upper, |quantity| {
                Ok(!relative(quantity, upper_band)?.is_gt())
            })?,
            first_true(1, upper, |quantity| {
                Ok(relative(quantity, lower_band)?.is_lt())
            })? - 1,
        ))
    }
}

/// Each array entry corresponds to its sealed instance ID. Clearing must verify
/// membership before marking an entry unavailable. Admission errors abort the
/// search; Ok(false) means this specific composition is financially ineligible.
pub fn select<E: From<QuoteError>>(
    order: Order,
    books: [Option<ExecutionCurve>; 3],
    mut admit: impl FnMut(&Allocation) -> Result<bool, E>,
) -> Result<Option<Allocation>, E> {
    if order.side > 1
        || !(1..=MAX_DEPTH).contains(&order.lots)
        || !(price_policy::MIN_REFERENCE_PRICE..=price_policy::MAX_REFERENCE_PRICE)
            .contains(&order.reference)
    {
        return Err(QuoteError::Bounds.into());
    }
    let mut domains = [(1, 0); 3];
    let mut best = None;
    let consider = |candidate: Allocation,
                    best: &mut Option<Allocation>,
                    admit: &mut dyn FnMut(&Allocation) -> Result<bool, E>|
     -> Result<bool, E> {
        if !order.within_limit(candidate.all_in)
            || best.is_some_and(|previous| !candidate.better(previous, order.side))
        {
            return Ok(true); // Even the optimistic candidate cannot improve the result.
        }
        if candidate.gross >= MIN_ORDER_ATOMS
            && candidate.fee <= order.max_fee
            && admit(&candidate)?
        {
            *best = Some(candidate);
            return Ok(true);
        }
        Ok(false)
    };
    for (instance, curve) in books.iter().enumerate() {
        let Some(curve) = curve else {
            continue;
        };
        let (lower, upper) = price_domain(*curve, order)?;
        domains[instance] = (lower, upper);
        if (lower..=upper).contains(&order.lots) {
            let mut lots = [0; 3];
            let mut amounts = [0; 3];
            lots[instance] = order.lots;
            amounts[instance] = curve.gross(order.lots)?;
            consider(
                Allocation::new(order.side, lots, amounts)?,
                &mut best,
                &mut admit,
            )?;
        }
    }

    // Depth-first subdivision holds at most 1 + ceil(log2(MAX_DEPTH)) intervals,
    // independent of the number of lots. Reuse the allocation across all pairs.
    let mut pending =
        Vec::with_capacity(1 + u64::BITS as usize - MAX_DEPTH.leading_zeros() as usize);
    for first in 0..3 {
        for second in first + 1..3 {
            let (Some(left), Some(right)) = (books[first], books[second]) else {
                continue;
            };
            let (left_min, left_max) = domains[first];
            let (right_min, right_max) = domains[second];
            if left_min > left_max || right_min > right_max {
                continue;
            }
            let lower = left_min.max(order.lots - right_max);
            let upper = left_max.min(order.lots - right_min);
            if lower > upper {
                continue;
            }
            let allocation = |quantity| {
                let mut lots = [0; 3];
                let mut amounts = [0; 3];
                lots[first] = quantity;
                lots[second] = order.lots - quantity;
                amounts[first] = left.gross(lots[first])?;
                amounts[second] = right.gross(lots[second])?;
                Allocation::new(order.side, lots, amounts)
            };
            pending.push((lower, upper));
            while let Some((lower, upper)) = pending.pop() {
                // Find the rightmost best gross in this interval, then include
                // any adjacent sell-price tie created by aggregate fee rounding.
                let optimum = first_true(lower, upper - 1, |quantity| {
                    let current = allocation(quantity)?.gross;
                    let next = allocation(quantity + 1)?.gross;
                    Ok(if order.side == 0 {
                        next > current
                    } else {
                        next < current
                    })
                })?;
                let mut candidate = allocation(optimum)?;
                if order.side == 1 && optimum < upper {
                    let tied = first_true(optimum + 1, upper, |quantity| {
                        Ok(allocation(quantity)?.all_in != candidate.all_in)
                    })? - 1;
                    if tied != optimum {
                        candidate = allocation(tied)?;
                    }
                }
                if consider(candidate, &mut best, &mut admit)? || lower == upper {
                    continue;
                }
                // Opposite extrema of a convex cost / concave revenue curve
                // occur at the endpoints. Eliminate impossible notional and
                // fee ranges even when every health check would have failed.
                let endpoints = [allocation(lower)?, allocation(upper)?];
                let (max_gross, min_fee) = if order.side == 0 {
                    (endpoints[0].gross.max(endpoints[1].gross), candidate.fee)
                } else {
                    (
                        allocation(optimum)?.gross,
                        endpoints[0].fee.min(endpoints[1].fee),
                    )
                };
                if max_gross < MIN_ORDER_ATOMS || min_fee > order.max_fee {
                    continue;
                }
                let middle = lower + (upper - lower) / 2;
                pending.extend([(middle + 1, upper), (lower, middle)]);
            }
        }
    }
    Ok(best)
}

#[cfg(test)]
mod tests;

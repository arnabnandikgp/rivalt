//! Integer allocation across a bounded set of canonical maker books.
//! Each book's marginal cost is nondecreasing, including its inventory skew.
//! Every lot cheaper than the cutoff is mandatory. Only lots at the cutoff tie.
use super::*;

const MAX_BOOKS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultiAllocation {
    pub lots: Vec<u64>,
    pub amounts: Vec<u64>,
    pub gross: u64,
    pub fee: u64,
    pub all_in: u64,
}

struct Book<'a> {
    curve: ExecutionCurve<'a>,
    capacity: u64,
    first: i64,
    last: i64,
}

impl Book<'_> {
    /// Number of lots costing at most this threshold. The constant-price and
    /// completely consumed cases need no search over the quantity.
    fn prefix(&self, threshold: i64) -> QuoteResult<u64> {
        if threshold < self.first {
            return Ok(0);
        }
        if threshold >= self.last {
            return Ok(self.capacity);
        }
        let mut low = 1;
        let mut high = self.capacity - 1;
        while low < high {
            let middle = low + (high - low + 1) / 2;
            if self.curve.marginal_cost(middle)? <= threshold {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        Ok(low)
    }
}

/// Published price optimum before full financial admission. An unaffordable
/// winner can never be committed by clearing. Caller supplies curves in stable
/// increasing registration order. None denotes an ineligible or absent book.
pub fn best_marginals(
    order: Order,
    curves: &[Option<ExecutionCurve>],
) -> QuoteResult<Option<MultiAllocation>> {
    if order.side > 1
        || order.lots == 0
        || order.lots > MAX_DEPTH
        || curves.is_empty()
        || curves.len() > MAX_BOOKS
    {
        return Err(QuoteError::Bounds);
    }
    let mut books = Vec::with_capacity(curves.len());
    let mut capacity = 0;
    for curve in curves {
        let Some(curve) = curve else {
            books.push(None);
            continue;
        };
        if curve.side() != order.side {
            return Err(QuoteError::Binding);
        }
        let limit = curve.capacity().min(order.lots);
        if limit == 0 {
            books.push(None);
            continue;
        }
        let first = curve.marginal_cost(1)?;
        // An invalid initial price cannot be skipped. Later lots can leave the
        // price domain. The cost increases for either direction of trading.
        let (floor, ceiling) = if order.side == 0 {
            (1, financial_core::MAX_PRICE as i64)
        } else {
            (-(financial_core::MAX_PRICE as i64), -1)
        };
        if first < floor || first > ceiling {
            books.push(None);
            continue;
        }
        let original = Book {
            curve: *curve,
            capacity: limit,
            first,
            last: curve.marginal_cost(limit)?,
        };
        let available = original.prefix(ceiling)?;
        let last = if available == limit {
            original.last
        } else {
            curve.marginal_cost(available)?
        };
        books.push(Some(Book {
            capacity: available,
            last,
            ..original
        }));
        capacity += available;
    }
    if capacity < order.lots {
        return Ok(None);
    }
    let mut low = books
        .iter()
        .flatten()
        .map(|book| book.first)
        .min()
        .ok_or(QuoteError::Capacity)?;
    let mut high = books
        .iter()
        .flatten()
        .map(|book| book.last)
        .max()
        .ok_or(QuoteError::Capacity)?;
    while low < high {
        let mid = low + (high - low) / 2;
        let mut supplied = 0;
        for book in books.iter().flatten() {
            supplied += book.prefix(mid)?;
            if supplied >= order.lots {
                break;
            }
        }
        if supplied >= order.lots {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    let mut lots = Vec::with_capacity(books.len());
    let mut tied = Vec::with_capacity(books.len());
    for book in &books {
        let (before, through) = match book {
            Some(book) => (book.prefix(low - 1)?, book.prefix(low)?),
            None => (0, 0),
        };
        lots.push(before);
        tied.push(through - before);
    }
    let needed = order.lots - lots.iter().sum::<u64>();
    // At most 256 masks. Minimize opened accounts first, then choose the
    // lexicographically earliest set. Prefer lower IDs for the remaining lots.
    let mut chosen: Option<(u32, u16)> = None;
    let bit = |index: usize| 1u16 << (books.len() - 1 - index);
    let mandatory = lots.iter().enumerate().fold(0, |mask, (index, quantity)| {
        if *quantity > 0 {
            mask | bit(index)
        } else {
            mask
        }
    });
    for mask in 1..1u16 << books.len() {
        if mask & mandatory != mandatory {
            continue;
        }
        let count = mask.count_ones();
        if chosen.is_some_and(|(best_count, best_mask)| {
            count > best_count || count == best_count && mask <= best_mask
        }) {
            continue;
        }
        let available = tied
            .iter()
            .enumerate()
            .filter(|(index, _)| mask & bit(*index) != 0)
            .map(|(_, quantity)| quantity)
            .sum::<u64>();
        if available >= needed {
            chosen = Some((count, mask));
        }
    }
    let (_, mask) = chosen.ok_or(QuoteError::Capacity)?;
    let mut remaining = needed;
    for (index, quantity) in lots.iter_mut().enumerate() {
        if mask & bit(index) != 0 {
            let allocation = remaining.min(tied[index]);
            *quantity += allocation;
            remaining -= allocation;
        }
    }
    let mut gross = 0u64;
    let mut amounts = Vec::with_capacity(books.len());
    for (book, quantity) in books.iter().zip(&lots) {
        let amount = if *quantity == 0 {
            0
        } else {
            book.as_ref()
                .ok_or(QuoteError::Capacity)?
                .curve
                .gross(*quantity)?
        };
        amounts.push(amount);
        gross = gross.checked_add(amount).ok_or(QuoteError::Arithmetic)?;
    }
    let fee = fee_total(gross).map_err(|_| QuoteError::Arithmetic)?;
    let all_in = if order.side == 0 {
        gross.checked_add(fee)
    } else {
        gross.checked_sub(fee)
    }
    .ok_or(QuoteError::Arithmetic)?;
    if gross < MIN_ORDER_ATOMS || fee > order.max_fee || !order.within_limit(all_in) {
        return Ok(None);
    }
    Ok(Some(MultiAllocation {
        lots,
        amounts,
        gross,
        fee,
        all_in,
    }))
}

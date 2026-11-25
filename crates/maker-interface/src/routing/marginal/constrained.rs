//! Fallback for an average-price collar, minimum notional or signed fee ceiling
//! that the unrestricted marginal winner violates. Every positive leg lies in
//! its own price domain. Search exhaustion is distinct from proven no-fill.
use super::*;

pub(super) fn in_band(reference: u64, lots: u64, gross: u64) -> bool {
    let scaled = gross * price_policy::EXECUTION_DENOMINATOR;
    let index = reference * lots;
    // Validated prices <= 1e6 and lots <= 1e8 bound all products below 2^64.
    index * price_policy::EXECUTION_LOWER_NUMERATOR <= scaled
        && scaled <= index * price_policy::EXECUTION_UPPER_NUMERATOR
}

pub(super) struct GrossWindow {
    low: u64,
    high: u64,
}

impl GrossWindow {
    pub(super) fn new(order: Order, best_gross: u64) -> QuoteResult<Option<Self>> {
        // fee_total(gross) = ceil(gross / 5000). Saturation means a nonbinding cap.
        let cap = order.max_fee.saturating_mul(5_000);
        let (low, high) = if order.side == 0 {
            (MIN_ORDER_ATOMS.max(best_gross), cap.min(order.all_in_limit))
        } else {
            (MIN_ORDER_ATOMS.max(order.all_in_limit), cap.min(best_gross))
        };
        if low > high {
            return Ok(None);
        }
        let target = if order.side == 0 { low } else { high };
        let fee = fee_total(target).map_err(|_| QuoteError::Arithmetic)?;
        let all_in = if order.side == 0 {
            target + fee
        } else {
            target - fee
        };
        Ok(order.within_limit(all_in).then_some(Self { low, high }))
    }

    pub(super) fn contains(&self, gross: u64) -> bool {
        self.low <= gross && gross <= self.high
    }
}

#[derive(Clone, Copy, Default)]
struct Domain {
    low: u64,
    high: u64,
}

struct Search<'a> {
    order: Order,
    curves: &'a [Option<ExecutionCurve<'a>>],
    domains: [Domain; MAX_BOOKS],
    mask: usize,
    lots: [u64; MAX_BOOKS],
    amounts: [u64; MAX_BOOKS],
    work: SearchWork,
    window: GrossWindow,
    target_all_in: u64,
    best: Option<MultiAllocation>,
}

pub(super) fn select(
    order: Order,
    curves: &[Option<ExecutionCurve>],
    window: GrossWindow,
) -> QuoteResult<Option<MultiAllocation>> {
    let mut search = Search {
        order,
        curves,
        domains: [Domain::default(); MAX_BOOKS],
        mask: 0,
        lots: [0; MAX_BOOKS],
        amounts: [0; MAX_BOOKS],
        target_all_in: 0,
        // Same transaction-bounded work allowance as the ordinary pair search.
        work: SearchWork {
            intervals: 24,
            quotes: 512,
            admissions: 0,
        },
        window,
        best: None,
    };
    for (index, curve) in curves.iter().enumerate() {
        if let Some(curve) = curve {
            let (low, high) = price_domain(&mut search.work, *curve, order)?;
            search.domains[index] = Domain { low, high };
        }
    }
    // Clipping upper endpoints preserves monotone marginals. If the optimum
    // also satisfies every nonzero minimum, no quantity enumeration is needed.
    let clipped: Vec<_> = curves
        .iter()
        .zip(&search.domains)
        .map(|(curve, domain)| {
            curve
                .filter(|_| domain.high > 0 && domain.low <= domain.high)
                .map(|book| book.limited_to(domain.high))
        })
        .collect();
    let Some(candidate) = price_optimum(order, &clipped)? else {
        return Ok(None);
    };
    let Some(window) = GrossWindow::new(order, candidate.gross)? else {
        return Ok(None);
    };
    if window.contains(candidate.gross)
        && order.within_limit(candidate.all_in)
        && candidate
            .lots
            .iter()
            .zip(&search.domains)
            .all(|(&lots, domain)| lots == 0 || lots >= domain.low)
    {
        return Ok(Some(candidate));
    }
    let target = if order.side == 0 {
        window.low
    } else {
        window.high
    };
    let fee = fee_total(target).map_err(|_| QuoteError::Arithmetic)?;
    search.target_all_in = if order.side == 0 {
        target + fee
    } else {
        target - fee
    };
    search.window = window;
    // Prefer fewer legs, then earlier registrations, then more lots on the
    // first differing registration. A reached monetary bound proves optimality.
    let masks = 1usize << curves.len();
    for count in 1..=curves.len() {
        for mask in (1..masks)
            .rev()
            .filter(|mask| mask.count_ones() as usize == count)
        {
            search.mask = mask;
            let (low, high) = search.remaining_range(0);
            if low <= order.lots && order.lots <= high && search.visit(0, order.lots, 0)? {
                return Ok(search.best);
            }
        }
    }
    Ok(search.best)
}

impl Search<'_> {
    fn used(&self, index: usize) -> bool {
        self.mask & (1 << (self.curves.len() - 1 - index)) != 0
    }

    fn remaining_range(&self, start: usize) -> (u64, u64) {
        let mut minimum = 0;
        let mut maximum = 0;
        for index in start..self.curves.len() {
            if self.used(index) {
                let domain = self.domains[index];
                if domain.high == 0 || domain.low > domain.high {
                    return (1, 0);
                }
                minimum += domain.low;
                maximum += domain.high;
            }
        }
        (minimum, maximum)
    }

    fn visit(&mut self, start: usize, remaining: u64, gross: u64) -> QuoteResult<bool> {
        let Some(index) = (start..self.curves.len()).find(|&index| self.used(index)) else {
            debug_assert_eq!(remaining, 0);
            if !self.window.contains(gross) {
                return Ok(false);
            }
            let fee = fee_total(gross).map_err(|_| QuoteError::Arithmetic)?;
            let all_in = if self.order.side == 0 {
                gross + fee
            } else {
                gross - fee
            };
            if self.order.within_limit(all_in)
                && self.best.as_ref().is_none_or(|best| {
                    if self.order.side == 0 {
                        all_in < best.all_in
                    } else {
                        all_in > best.all_in
                    }
                })
            {
                self.best = Some(MultiAllocation {
                    lots: self.lots[..self.curves.len()].to_vec(),
                    amounts: self.amounts[..self.curves.len()].to_vec(),
                    gross,
                    fee,
                    all_in,
                });
                return Ok(all_in == self.target_all_in);
            }
            return Ok(false);
        };
        let (next_minimum, next_maximum) = self.remaining_range(index + 1);
        let domain = self.domains[index];
        let low = domain.low.max(remaining.saturating_sub(next_maximum));
        let high = domain.high.min(remaining - next_minimum);
        for quantity in (low..=high).rev() {
            SearchWork::spend(&mut self.work.intervals)?;
            let amount = SearchWork::gross(
                &mut self.work.quotes,
                self.curves[index].ok_or(QuoteError::Binding)?,
                quantity,
            )?;
            let total = gross.checked_add(amount).ok_or(QuoteError::Arithmetic)?;
            if total > self.window.high {
                continue;
            }
            self.lots[index] = quantity;
            self.amounts[index] = amount;
            if self.visit(index + 1, remaining - quantity, total)? {
                return Ok(true);
            }
        }
        self.lots[index] = 0;
        self.amounts[index] = 0;
        Ok(false)
    }
}

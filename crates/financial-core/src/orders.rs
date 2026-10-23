//! Conservative remaining-order reservations. Clearing owns stored authority.
use super::*;

pub fn reserve(
    lots: u64,
    limit: u64,
    fee_left: u64,
    side: u8,
    reduce_only: bool,
    lower: u64,
    upper: u64,
) -> Result<u64> {
    if side > 1
        || lots > 4_608
        || !(9_000..=110_000).contains(&limit)
        || fee_left > 1_000_000
        || lower == 0
        || lower > upper
        || upper > MAX_PRICE
    {
        return Err(Error::Bounds);
    }
    if lots == 0 {
        return Ok(0);
    }
    let loss = if side == 0 {
        limit.saturating_sub(lower)
    } else {
        upper.saturating_sub(limit)
    };
    let im = if reduce_only { 0 } else { upper.div_ceil(10) };
    cash_add(
        lots.checked_mul(cash_add(loss, im)?)
            .ok_or(Error::Overflow)?,
        fee_left,
    )
}

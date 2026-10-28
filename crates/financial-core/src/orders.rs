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
    ReservationRate::new(limit, fee_left, side, reduce_only, lower, upper)?.for_lots(lots)
}

/// Validated fixed terms of an order reservation. Reuse across hypothetical
/// quantities without repeating price/side/fee validation or changing rounding.
#[derive(Clone, Copy, Debug)]
pub struct ReservationRate {
    per_lot: u64,
    fee_left: u64,
}

impl ReservationRate {
    pub fn new(
        limit: u64,
        fee_left: u64,
        side: u8,
        reduce_only: bool,
        lower: u64,
        upper: u64,
    ) -> Result<Self> {
        if side > 1
            || !(9_000..=110_000).contains(&limit)
            || fee_left > 1_000_000
            || lower == 0
            || lower > upper
            || upper > MAX_PRICE
        {
            return Err(Error::Bounds);
        }
        let loss = if side == 0 {
            limit.saturating_sub(lower)
        } else {
            upper.saturating_sub(limit)
        };
        let initial = if reduce_only { 0 } else { upper.div_ceil(10) };
        Ok(Self {
            per_lot: cash_add(loss, initial)?,
            fee_left,
        })
    }

    pub fn for_lots(&self, lots: u64) -> Result<u64> {
        if lots > 4_608 {
            return Err(Error::Bounds);
        }
        if lots == 0 {
            return Ok(0);
        }
        cash_add(
            lots.checked_mul(self.per_lot).ok_or(Error::Overflow)?,
            self.fee_left,
        )
    }
}

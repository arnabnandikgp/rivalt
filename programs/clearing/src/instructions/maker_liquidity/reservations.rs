//! Compile fixed book authority/terms once, then project each hypothetical
//! maker position. Generation, direction and position-sized protection remain
//! per-quantity decisions. The selected legs still run the complete route path.
use super::*;
use crate::state::v2::{GroupMarketV2, MarginAccountV2};
use financial_core::{self as math, orders::ReservationRate};

#[derive(Clone, Copy)]
struct PreparedOrder {
    remaining: u64,
    side: u8,
    reduce_only: bool,
    generation: u64,
    rate: Option<ReservationRate>,
}

pub(crate) struct Reservations {
    orders: [Option<PreparedOrder>; 4],
}

impl Reservations {
    pub(crate) fn new(root: &MarginAccountV2, market: &GroupMarketV2, slot: u64) -> Self {
        let live_delegate = root.delegate != Pubkey::default() && slot < root.delegate_expiry_slot;
        let orders = root.book.orders.map(|stored| {
            let order = stored.order;
            if !order.active()
                || slot >= order.expiry_slot
                || order.terms_epoch != market.terms_epoch
                || (stored.delegate_epoch != 0
                    && (!live_delegate || stored.delegate_epoch != root.delegate_epoch))
            {
                return None;
            }
            let mut remaining = order.lots - order.filled; // validated complete book
            if order.group_id > 0 {
                let protection = root.book.protections.iter().find(|entry| {
                    entry.protection.id == order.group_id
                        && entry.market_index == stored.market_index
                })?;
                if protection.protection.remaining == 0 {
                    return None;
                }
                remaining = remaining.min(protection.protection.remaining);
            }
            Some(PreparedOrder {
                remaining,
                side: order.side,
                reduce_only: order.reduce_only,
                generation: order.generation,
                rate: ReservationRate::new(
                    order.limit,
                    order.fee_budget - order.fee_charged,
                    order.side,
                    order.reduce_only,
                    market.lower,
                    market.upper,
                )
                .ok(),
            })
        });
        Self { orders }
    }

    pub(crate) fn required(&self, lots: i64, generation: u64) -> math::Result<u64> {
        let mut reserved = 0;
        for order in self.orders.iter().flatten() {
            if order.reduce_only
                && (lots == 0
                    || generation != order.generation
                    || ((order.side == 0) != (lots < 0)))
            {
                continue;
            }
            let remaining = if order.reduce_only {
                order.remaining.min(lots.unsigned_abs())
            } else {
                order.remaining
            };
            reserved = math::cash_add(
                reserved,
                order
                    .rate
                    .as_ref()
                    .ok_or(math::Error::Bounds)?
                    .for_lots(remaining)?,
            )?;
        }
        Ok(reserved)
    }
}

//! Cash required to withdraw from a margin account after funding accrual and order refresh.
//! Clearing supplies the complete occupied slot list and authenticates its market data.
use crate::{margin_atoms, Risk, IM_BPS};
use clearing_accounting::{
    add, cash_add, scaled, sub, Error, Position, Result, MAX_CASH, MAX_FUNDING,
};

pub struct OccupiedSlot {
    pub market: u16,
    pub position: Position,
}

#[derive(Clone, Copy)]
pub struct MarketWindow {
    pub market: u16,
    pub current: Risk,
    pub funding_low: i128,
    pub funding_high: i128,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CashRequired {
    /// Current initial margin, remaining-order reservations and negative claims.
    pub current_scaled: i128,
    /// Negative claims at the worst simultaneous funding endpoints.
    pub held_scaled: i128,
}

/// Inputs are in increasing market ID order. Only open positions need valuation
/// windows here. Any source needed by an order must already have been checked
/// when refreshing its reservation. A flat slot can still carry a fixed debt.
pub fn cash_required(
    slots: &[OccupiedSlot],
    windows: &[MarketWindow],
    reserved: u64,
) -> Result<CashRequired> {
    if reserved > MAX_CASH {
        return Err(Error::Bounds);
    }
    let mut initial_and_reserved = reserved;
    let mut current_debt = 0;
    let mut held_debt = 0;
    let mut windows = windows.iter();
    let mut previous = None;
    for slot in slots {
        if previous.is_some_and(|market| market >= slot.market) {
            return Err(Error::Invariant);
        }
        previous = Some(slot.market);
        let position = &slot.position;
        position.validate()?;
        if position.lots == 0 {
            let fixed_loss = position.virtual_scaled.min(0);
            current_debt = sub(current_debt, fixed_loss)?;
            held_debt = sub(held_debt, fixed_loss)?;
            continue;
        }
        let window = windows.next().ok_or(Error::Invariant)?;
        if window.market != slot.market || position.funding_checkpoint != window.current.funding {
            return Err(Error::Invariant);
        }
        if window.funding_low > window.current.funding
            || window.funding_high < window.current.funding
            || window.funding_low.unsigned_abs() > MAX_FUNDING as u128
            || window.funding_high.unsigned_abs() > MAX_FUNDING as u128
        {
            return Err(Error::Bounds);
        }
        let price = window.current.adverse_price(position.lots)?;
        initial_and_reserved = cash_add(
            initial_and_reserved,
            margin_atoms(position.lots, window.current.upper, IM_BPS)?,
        )?;
        // The funding term in a claim is -lots * (funding - checkpoint).
        // Clipping positive claims to zero preserves that direction of change.
        let adverse_funding = if position.lots > 0 {
            window.funding_high
        } else {
            window.funding_low
        };
        current_debt = sub(
            current_debt,
            position.unpaid(price, window.current.funding)?.min(0),
        )?;
        held_debt = sub(held_debt, position.unpaid(price, adverse_funding)?.min(0))?;
    }
    if windows.next().is_some() {
        return Err(Error::Invariant);
    }
    Ok(CashRequired {
        current_scaled: add(scaled(initial_and_reserved)?, current_debt)?,
        held_scaled: held_debt,
    })
}

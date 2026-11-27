//! Shared checked units and position accounting used by risk, execution and settlement.
#![no_std]

#[cfg(feature = "surviving-profit")]
pub mod attribution;
#[cfg(feature = "surviving-profit")]
pub mod entry_cost;
#[cfg(feature = "surviving-profit")]
pub mod market_slots;
pub mod price_policy;
pub use price_policy::MAX_PRICE;

pub const SCALE: i128 = 1_000_000_000;
pub const MAX_LOTS: i64 = 100_000_000;
pub const MAX_CASH: u64 = 1_000_000_000_000_000;
pub const MAX_SCALED: i128 = 100_000_000_000_000_000_000_000_000;
pub const MAX_FUNDING: i128 = 1_000_000_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Bounds,
    Overflow,
    InsufficientCash,
    Entitlement,
    Health,
    Cohort,
    Invariant,
    Generation,
}
pub type Result<T> = core::result::Result<T, Error>;

pub fn add(left: i128, right: i128) -> Result<i128> {
    left.checked_add(right).ok_or(Error::Overflow)
}
pub fn sub(left: i128, right: i128) -> Result<i128> {
    left.checked_sub(right).ok_or(Error::Overflow)
}
pub fn mul(left: i128, right: i128) -> Result<i128> {
    left.checked_mul(right).ok_or(Error::Overflow)
}
pub fn cash_add(left: u64, right: u64) -> Result<u64> {
    let sum = left.checked_add(right).ok_or(Error::Overflow)?;
    if sum > MAX_CASH {
        return Err(Error::Bounds);
    }
    Ok(sum)
}
pub fn cash_sub(balance: u64, amount: u64) -> Result<u64> {
    if balance > MAX_CASH || amount > MAX_CASH {
        return Err(Error::Bounds);
    }
    balance.checked_sub(amount).ok_or(Error::InsufficientCash)
}
pub fn scaled(atoms: u64) -> Result<i128> {
    mul(i128::from(atoms), SCALE)
}

pub const MARKETS: usize = 2;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Position {
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint: i128,
    pub generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Custody with no position or reservation in this account view.
    CashOnly,
    Isolated(usize),
    Cross,
}

impl Position {
    pub fn validate(&self) -> Result<()> {
        if self.lots.unsigned_abs() > MAX_LOTS as u64
            || self.virtual_scaled.unsigned_abs() > MAX_SCALED as u128
            || self.funding_checkpoint.unsigned_abs() > MAX_FUNDING as u128
            || (self.lots != 0 && self.generation == u64::MAX)
        {
            return Err(Error::Bounds);
        }
        Ok(())
    }
    pub fn unpaid(&self, price: u64, funding: i128) -> Result<i128> {
        self.validate()?;
        if price == 0 || price > MAX_PRICE || funding.unsigned_abs() > MAX_FUNDING as u128 {
            return Err(Error::Bounds);
        }
        // Derived valuation has headroom beyond the ordinary stored-v bound.
        // Default must remain calculable at that bound even if an ordinary
        // accrual/fill cannot store another unit of exposure.
        let accrued = sub(
            self.virtual_scaled,
            mul(
                i128::from(self.lots),
                sub(funding, self.funding_checkpoint)?,
            )?,
        )?;
        add(accrued, mul(i128::from(self.lots), scaled(price)?)?)
    }
}

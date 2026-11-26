//! Whole-account margin policy for authenticated price bounds and funding indices.
//! Accounting supplies the signed claims. This crate reads balances and returns
//! decisions to the caller that owns the proposed financial transition.
#![no_std]

use clearing_accounting::{
    add, cash_add, scaled, sub, Error, Mode, Position, Result, MARKETS, MAX_CASH, MAX_LOTS, MAX_PRICE,
};

pub mod orders;
pub mod withdrawal;

pub const IM_BPS: u64 = 1_000;
pub const MM_BPS: u64 = 500;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Risk {
    pub lower: u64,
    pub upper: u64,
    pub funding: i128,
}

impl Risk {
    pub fn adverse_price(self, lots: i64) -> Result<u64> {
        if self.lower == 0 || self.lower > self.upper || self.upper > MAX_PRICE {
            return Err(Error::Bounds);
        }
        Ok(if lots < 0 { self.upper } else { self.lower })
    }
}

/// Round each market's requirement up to whole collateral atoms before summing.
pub fn margin_atoms(lots: i64, upper: u64, bps: u64) -> Result<u64> {
    if lots.unsigned_abs() > MAX_LOTS as u64 || upper == 0 || upper > MAX_PRICE || bps > 10_000 {
        return Err(Error::Bounds);
    }
    let numerator = u128::from(lots.unsigned_abs()) * u128::from(upper) * u128::from(bps);
    u64::try_from(numerator.div_ceil(10_000)).map_err(|_| Error::Overflow)
}

/// Largest absolute position that funded cash alone could margin after a fill.
/// Ignoring reservations and negative claims makes this an upper bound.
pub fn funded_position_limit(cash: u64, upper: u64) -> Result<i64> {
    funded_opening_limit(cash, upper, 0)
}

/// A flat account must cover IM and any adverse claim from funded cash.
/// `loss_per_lot` is a lower bound on the loss, in whole collateral atoms.
pub fn funded_opening_limit(cash: u64, upper: u64, loss_per_lot: u64) -> Result<i64> {
    if cash > MAX_CASH || !(1..=MAX_PRICE).contains(&upper) || loss_per_lot > MAX_PRICE {
        return Err(Error::Bounds);
    }
    let numerator = cash.checked_mul(10_000).ok_or(Error::Overflow)?;
    // MAX_PRICE bounds both terms. Integer division here is equivalent to rounding IM up.
    let per_lot = upper * IM_BPS + loss_per_lot * 10_000;
    Ok((numerator / per_lot).min(MAX_LOTS as u64) as i64)
}

/// Borrowed account input. The program adapter supplies all positions of the
/// same margin account and authenticates each bound before requesting admission.
#[derive(Clone, Copy)]
pub struct Account<'a> {
    pub id: u64,
    pub mode: Mode,
    pub cash: u64,
    pub reserved: u64,
    pub positions: &'a [Position; MARKETS],
}

impl Account<'_> {
    pub fn allows(self, market: usize) -> bool {
        market < MARKETS
            && match self.mode {
                Mode::Isolated(index) => index == market,
                Mode::Cross => true,
            }
    }

    pub fn validate(self) -> Result<()> {
        if self.cash > MAX_CASH
            || self.reserved > MAX_CASH
            || matches!(self.mode, Mode::Isolated(index) if index >= MARKETS)
        {
            return Err(Error::Bounds);
        }
        for (index, position) in self.positions.iter().enumerate() {
            if !self.allows(index) && *position != Position::default() {
                return Err(Error::Invariant);
            }
            position.validate()?;
        }
        Ok(())
    }

    /// Cash is counted once. Only the negative part of each market's unpaid
    /// claim enters risk equity, including its funding at the supplied index.
    pub fn risk_equity(self, risks: [Risk; MARKETS]) -> Result<i128> {
        self.validate()?;
        let mut equity = scaled(self.cash)?;
        for (index, risk) in risks.into_iter().enumerate() {
            if self.allows(index) {
                let position = &self.positions[index];
                let price = risk.adverse_price(position.lots)?;
                equity = add(equity, position.unpaid(price, risk.funding)?.min(0))?;
            }
        }
        Ok(equity)
    }

    pub fn requirement(self, risks: [Risk; MARKETS], bps: u64) -> Result<u64> {
        self.validate()?;
        let mut required = 0;
        for (index, risk) in risks.into_iter().enumerate() {
            if self.allows(index) {
                required = cash_add(
                    required,
                    margin_atoms(self.positions[index].lots, risk.upper, bps)?,
                )?;
            }
        }
        Ok(required)
    }

    pub fn deficit(self, risks: [Risk; MARKETS]) -> Result<i128> {
        Ok(sub(
            scaled(self.requirement(risks, MM_BPS)?)?,
            self.risk_equity(risks)?,
        )?
        .max(0))
    }

    /// Initial margin and order reserves share one traversal on the fill path.
    pub fn admissible(self, risks: [Risk; MARKETS]) -> Result<()> {
        self.validate()?;
        let mut required = self.reserved;
        let mut equity = scaled(self.cash)?;
        for (index, risk) in risks.into_iter().enumerate() {
            if self.allows(index) {
                let position = &self.positions[index];
                let price = risk.adverse_price(position.lots)?;
                required = cash_add(required, margin_atoms(position.lots, risk.upper, IM_BPS)?)?;
                equity = add(equity, position.unpaid(price, risk.funding)?.min(0))?;
            }
        }
        if equity < scaled(required)? {
            return Err(Error::Health);
        }
        Ok(())
    }

    /// A reduction below IM must shrink the existing position without crossing
    /// zero and strictly improve the account's maintenance deficit after fees.
    pub fn admit_reduction(self, next: Self, market: usize, risks: [Risk; MARKETS]) -> Result<()> {
        if self.id != next.id || self.mode != next.mode || !self.allows(market) {
            return Err(Error::Invariant);
        }
        if next.admissible(risks).is_ok() {
            return Ok(());
        }
        let before = self.positions[market].lots;
        let after = next.positions[market].lots;
        if before == 0
            || after.unsigned_abs() >= before.unsigned_abs()
            || (after != 0 && before.signum() != after.signum())
            || next.deficit(risks)? >= self.deficit(risks)?
        {
            return Err(Error::Health);
        }
        Ok(())
    }
}

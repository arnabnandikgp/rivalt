//! Schema-2 accounting: cash belongs to a root, positions belong to its fixed markets.
//! Authority, order validity, source authentication and release gates are the caller's job.
use super::*;

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
    Isolated(usize),
    Cross,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Margin {
    pub id: u16,
    pub mode: Mode,
    pub cash: u64,
    pub positions: [Position; MARKETS],
    pub reserved: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Risk {
    pub lower: u64,
    pub upper: u64,
    pub funding: i128,
}

impl Margin {
    pub fn allows(&self, market: usize) -> bool {
        market < MARKETS
            && match self.mode {
                Mode::Isolated(index) => index == market,
                Mode::Cross => true,
            }
    }

    pub fn validate(&self) -> Result<()> {
        if self.id >= MAX_PARTICIPANTS as u16
            || self.cash > MAX_CASH
            || self.reserved > MAX_CASH
            || matches!(self.mode, Mode::Isolated(index) if index >= MARKETS)
        {
            return Err(Error::Bounds);
        }
        for (index, position) in self.positions.iter().enumerate() {
            if !self.allows(index) && *position != Position::default() {
                return Err(Error::Invariant);
            }
            self.selected(index)?.validate()?;
        }
        Ok(())
    }

    /// An ephemeral view into one position; never a second authoritative cash balance.
    fn selected(&self, market: usize) -> Result<Participant> {
        let position = self.positions.get(market).ok_or(Error::Bounds)?;
        Ok(Participant {
            id: self.id,
            cash: self.cash,
            lots: position.lots,
            virtual_scaled: position.virtual_scaled,
            funding_checkpoint: position.funding_checkpoint,
            generation: position.generation,
            reserved: 0,
        })
    }

    fn with_selected(mut self, market: usize, selected: Participant) -> Result<Self> {
        if !self.allows(market) || selected.id != self.id || selected.reserved != 0 {
            return Err(Error::Invariant);
        }
        selected.validate()?;
        self.cash = selected.cash;
        self.positions[market] = Position {
            lots: selected.lots,
            virtual_scaled: selected.virtual_scaled,
            funding_checkpoint: selected.funding_checkpoint,
            generation: selected.generation,
        };
        self.validate()?;
        Ok(self)
    }

    pub fn accrued(&self, funding: [i128; MARKETS]) -> Result<Self> {
        self.validate()?;
        let mut next = *self;
        for (market, index) in funding.into_iter().enumerate() {
            if self.allows(market) {
                next = next.with_selected(market, next.selected(market)?.accrued(index)?)?;
            }
        }
        Ok(next)
    }

    /// Funded cash once, plus each negative market claim. Positive claims never offset losses.
    pub fn risk_equity(&self, risks: [Risk; MARKETS]) -> Result<i128> {
        self.validate()?;
        let mut equity = scaled(self.cash)?;
        for (market, risk) in risks.into_iter().enumerate() {
            if !self.allows(market) {
                continue;
            }
            if risk.lower == 0 || risk.lower > risk.upper || risk.upper > MAX_PRICE {
                return Err(Error::Bounds);
            }
            let selected = self.selected(market)?;
            let price = if selected.lots < 0 {
                risk.upper
            } else {
                risk.lower
            };
            equity = add(equity, selected.unpaid(price, risk.funding)?.min(0))?;
        }
        Ok(equity)
    }

    pub fn requirement(&self, risks: [Risk; MARKETS], bps: u64) -> Result<u64> {
        self.validate()?;
        let mut required = 0;
        for (market, risk) in risks.into_iter().enumerate() {
            if self.allows(market) {
                required = cash_add(required, self.selected(market)?.margin(risk.upper, bps)?)?;
            }
        }
        Ok(required)
    }

    pub fn admissible(&self, risks: [Risk; MARKETS]) -> Result<()> {
        let required = cash_add(self.requirement(risks, IM_BPS)?, self.reserved)?;
        if self.risk_equity(risks)? < scaled(required)? {
            return Err(Error::Health);
        }
        Ok(())
    }
}

/// Shared paired fill and cumulative fee arithmetic. The caller must recompute
/// all order reservations and admit every returned root before committing it.
pub fn route_candidate(
    trader: Margin,
    makers: &[Margin],
    market: usize,
    legs: &[(u64, u64)],
    side: u8,
    funding: [i128; MARKETS],
    prefix: u64,
) -> Result<(Margin, Vec<Margin>, u64)> {
    trader.validate()?;
    if !trader.allows(market) || makers.is_empty() || makers.len() > 2 {
        return Err(Error::Bounds);
    }
    let trader = trader.accrued(funding)?;
    let mut accrued_makers = Vec::with_capacity(makers.len());
    for maker in makers {
        maker.validate()?;
        if maker.mode != Mode::Isolated(market) {
            return Err(Error::Invariant);
        }
        accrued_makers.push(maker.accrued(funding)?);
    }
    let selected_makers: Vec<_> = accrued_makers
        .iter()
        .map(|maker| maker.selected(market))
        .collect::<Result<_>>()?;
    let (selected_trader, selected_makers, fee) = route::candidate(
        trader.selected(market)?,
        &selected_makers,
        legs,
        side,
        funding[market],
        prefix,
    )?;
    let trader = trader.with_selected(market, selected_trader)?;
    let makers = accrued_makers
        .into_iter()
        .zip(selected_makers)
        .map(|(maker, selected)| maker.with_selected(market, selected))
        .collect::<Result<_>>()?;
    Ok((trader, makers, fee))
}

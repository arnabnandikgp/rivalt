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
    pub fn claims(
        &self,
        prices: [u64; MARKETS],
        funding: [i128; MARKETS],
    ) -> Result<[i128; MARKETS]> {
        self.validate()?;
        let mut claims = [0; MARKETS];
        for market in 0..MARKETS {
            if self.allows(market) {
                claims[market] = self
                    .selected(market)?
                    .unpaid(prices[market], funding[market])?;
            }
        }
        Ok(claims)
    }

    /// Economic solvency uses common claims, including positive claims. This is
    /// deliberately different from conservative admission equity.
    pub fn net_equity(&self, prices: [u64; MARKETS], funding: [i128; MARKETS]) -> Result<i128> {
        self.claims(prices, funding)?
            .into_iter()
            .try_fold(scaled(self.cash)?, add)
    }

    pub fn deficit(&self, risks: [Risk; MARKETS]) -> Result<i128> {
        Ok(sub(
            scaled(self.requirement(risks, MM_BPS)?)?,
            self.risk_equity(risks)?,
        )?
        .max(0))
    }

    pub fn withdraw(&self, amount: u64, risks: [Risk; MARKETS]) -> Result<Self> {
        if amount == 0 {
            return Err(Error::Bounds);
        }
        let mut next = self.accrued(risks.map(|risk| risk.funding))?;
        next.cash = cash_sub(next.cash, amount)?;
        next.admissible(risks)?;
        Ok(next)
    }

    /// Exact closed-claim cancellation inside one cross root. The caller also
    /// authenticates owner/group and rejects active order/protection authority.
    /// No settlement cash, insurance or sibling balance participates.
    pub fn net_closed_claims(&self, funding: [i128; MARKETS]) -> Result<Self> {
        self.validate()?;
        if self.mode != Mode::Cross
            || self.reserved != 0
            || self.positions.iter().any(|position| position.lots != 0)
        {
            return Err(Error::Bounds);
        }
        let mut next = self.accrued(funding)?;
        let claims = next.positions.map(|position| position.virtual_scaled);
        let (positive, negative) = if claims[0] > 0 && claims[1] < 0 {
            (0, 1)
        } else if claims[1] > 0 && claims[0] < 0 {
            (1, 0)
        } else {
            return Err(Error::Bounds);
        };
        let cancelled = claims[positive].min(sub(0, claims[negative])?);
        next.positions[positive].virtual_scaled = sub(claims[positive], cancelled)?;
        next.positions[negative].virtual_scaled = add(claims[negative], cancelled)?;
        next.validate()?;
        Ok(next)
    }

    /// Explicit whole-atom movement between a market claim and funded cash.
    /// The caller supplies a complete-group certificate before paying a gain.
    pub fn settle_claim(
        &self,
        pools: Pools,
        market: usize,
        amount: u64,
        prices: [u64; MARKETS],
        risks: [Risk; MARKETS],
        gain: bool,
    ) -> Result<(Self, Pools)> {
        if !self.allows(market) {
            return Err(Error::Bounds);
        }
        let accrued = self.accrued(risks.map(|risk| risk.funding))?;
        let change = if gain { settle } else { collect };
        let (selected, pools) = change(
            accrued.selected(market)?,
            pools,
            amount,
            prices[market],
            risks[market].funding,
        )?;
        let next = accrued.with_selected(market, selected)?;
        if gain {
            next.admissible(risks)?;
        }
        Ok((next, pools))
    }

    /// Reduce-only execution below IM requires a strict decrease in absolute
    /// selected exposure AND whole-account MM deficit after fees.
    pub fn admit_reduction(
        &self,
        next: &Self,
        market: usize,
        risks: [Risk; MARKETS],
    ) -> Result<()> {
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

/// Same-owner/group authority and the complete-group exit certificate belong to
/// the caller. Donor admission includes all pending funding and refreshed reserves;
/// adding cash may improve an unhealthy recipient without granting trading rights.
pub fn transfer_candidate(
    donor: Margin,
    recipient: Margin,
    amount: u64,
    risks: [Risk; MARKETS],
) -> Result<(Margin, Margin)> {
    if donor.id == recipient.id {
        return Err(Error::Invariant);
    }
    let next_donor = donor.withdraw(amount, risks)?;
    let mut next_recipient = recipient.accrued(risks.map(|risk| risk.funding))?;
    next_recipient.cash = cash_add(next_recipient.cash, amount)?;
    next_recipient.validate()?;
    Ok((next_donor, next_recipient))
}

/// A bounded, consenting receiver takes one selected position. Both cash balances
/// are unique root balances, and all markets participate in health after the fee.
/// Order cancellation/reservation refresh and receiver admission belong to the
/// caller, which must commit all candidates atomically.
pub fn liquidation_candidate(
    target: Margin,
    receiver: Margin,
    market: usize,
    lots: u64,
    price: u64,
    reference: u64,
    risks: [Risk; MARKETS],
) -> Result<(Margin, Margin, u64)> {
    target.validate()?;
    receiver.validate()?;
    if !target.allows(market)
        || !receiver.allows(market)
        || target.id == receiver.id
        || lots == 0
        || lots > liquidation::MAX_LIQUIDATION_LOTS
        || lots > target.positions[market].lots.unsigned_abs()
        || reference == 0
        || reference > MAX_PRICE
        || price == 0
        || price > MAX_PRICE
        || u128::from(price) * 10 < u128::from(reference) * 9
        || u128::from(price) * 10 > u128::from(reference) * 11
    {
        return Err(Error::Bounds);
    }
    let before = target.deficit(risks)?;
    if before == 0 {
        return Err(Error::Health);
    }
    let funding = risks.map(|risk| risk.funding);
    let target = target.accrued(funding)?;
    let receiver = receiver.accrued(funding)?;
    let notional = lots.checked_mul(price).ok_or(Error::Overflow)?;
    let (target_position, receiver_position) = if target.positions[market].lots > 0 {
        let (receiver_position, target_position) = fill(
            receiver.selected(market)?,
            target.selected(market)?,
            lots,
            notional,
            funding[market],
        )?;
        (target_position, receiver_position)
    } else {
        fill(
            target.selected(market)?,
            receiver.selected(market)?,
            lots,
            notional,
            funding[market],
        )?
    };
    let mut next_target = target.with_selected(market, target_position)?;
    let mut next_receiver = receiver.with_selected(market, receiver_position)?;
    let fee = notional
        .div_ceil(2_000)
        .min(liquidation::MAX_LIQUIDATION_FEE)
        .min(next_target.cash);
    next_target.cash = cash_sub(next_target.cash, fee)?;
    next_receiver.cash = cash_add(next_receiver.cash, fee)?;
    if next_target.positions[market].lots.unsigned_abs()
        >= target.positions[market].lots.unsigned_abs()
        || next_target.deficit(risks)? >= before
    {
        return Err(Error::Health);
    }
    Ok((next_target, next_receiver, fee))
}

/// Complete-cohort invariants; callers cannot establish solvency by selecting a
/// profitable subset. Claim aggregation never stores a derived claim as ordinary v.
pub fn reconcile(
    cohort: &[Margin],
    pools: Pools,
    prices: [u64; MARKETS],
    funding: [i128; MARKETS],
) -> Result<()> {
    if cohort.is_empty()
        || cohort.len() > MAX_PARTICIPANTS
        || [pools.vault, pools.settlement, pools.insurance, pools.fees]
            .iter()
            .any(|value| *value > MAX_CASH)
    {
        return Err(Error::Bounds);
    }
    let mut cash = 0;
    let mut lots = [0i128; MARKETS];
    let mut gross = [0u64; MARKETS];
    let mut claims = 0;
    for (index, root) in cohort.iter().enumerate() {
        root.validate()?;
        if cohort[..index].iter().any(|other| other.id == root.id) {
            return Err(Error::Invariant);
        }
        cash = cash_add(cash, root.cash)?;
        for market in 0..MARKETS {
            lots[market] = add(lots[market], i128::from(root.positions[market].lots))?;
            gross[market] = gross[market]
                .checked_add(root.positions[market].lots.unsigned_abs())
                .ok_or(Error::Overflow)?;
        }
        claims = root
            .claims(prices, funding)?
            .into_iter()
            .try_fold(claims, add)?;
    }
    if lots != [0; MARKETS]
        || gross.iter().any(|value| *value > MAX_GROSS_LOTS)
        || claims != scaled(pools.settlement)?
        || cash_add(
            cash_add(cash_add(cash, pools.settlement)?, pools.insurance)?,
            pools.fees,
        )? != pools.vault
    {
        return Err(Error::Invariant);
    }
    Ok(())
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

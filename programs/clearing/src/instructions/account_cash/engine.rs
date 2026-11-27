//! Checked candidates share the existing account and order engine. Expected
//! financial boundaries are independently enumerated in this module's tests.
use super::*;
use crate::engine::book;
use math::margin::{Margin, Risk};

pub(crate) struct Snapshot {
    pub markets: [Option<Market>; 2],
    pub risks: [Risk; 2],
    pub bounds: [[i128; 2]; 2],
    pub clock: Clock,
}

impl Snapshot {
    pub(crate) fn new(markets: [&Market; 2], clock: &Clock) -> Result<Self> {
        Self::optional(markets.map(Some), clock)
    }

    pub(crate) fn optional(markets: [Option<&Market>; 2], clock: &Clock) -> Result<Self> {
        let views = [
            markets[0].map(trading::market_view).transpose()?,
            markets[1].map(trading::market_view).transpose()?,
        ];
        let environment =
            trading::optional_environment(views.each_ref().map(Option::as_ref), 2, clock)?;
        let risks = environment.risks();
        let bounds = [
            views[0]
                .as_ref()
                .map(|market| crate::engine::oracle::funding_bounds(2, market, clock))
                .transpose()?
                .unwrap_or([0; 2]),
            views[1]
                .as_ref()
                .map(|market| crate::engine::oracle::funding_bounds(2, market, clock))
                .transpose()?
                .unwrap_or([0; 2]),
        ];
        Ok(Self {
            markets: views,
            risks,
            bounds,
            clock: clock.clone(),
        })
    }

    pub(crate) fn market(&self, index: usize) -> Result<&Market> {
        self.markets
            .get(index)
            .and_then(Option::as_ref)
            .ok_or_else(|| ProgramError::from(ClearingError::OrderState))
    }

    fn commit_model(&self, root: &mut MarginAccount, candidate: Margin) -> Result<()> {
        crate::engine::markets::commit_model(
            root,
            candidate,
            self.markets.each_ref().map(Option::as_ref),
        )
    }

    pub(crate) fn refresh(
        &self,
        root: &MarginAccount,
        require_sources: bool,
    ) -> Result<Box<MarginAccount>> {
        crate::engine::markets::validate(self.markets.each_ref().map(Option::as_ref), &[root], 0)?;
        let mut next = trading::root_view(root)?;
        let environment = trading::optional_environment(
            self.markets.each_ref().map(Option::as_ref),
            2,
            &self.clock,
        )?;
        book::refresh_with_environment(&mut next, &environment)?;
        if require_sources {
            for index in 0..2 {
                if next.positions[index].lots != 0
                    || next.book.orders.iter().any(|entry| {
                        entry.order.active() && usize::from(entry.market_index) == index
                    })
                {
                    crate::engine::oracle::action(self.market(index)?, &self.clock, false)?;
                }
            }
        }
        let accrued = checked(
            crate::engine::account::model(&next)?.accrued(self.risks.map(|risk| risk.funding)),
        )?;
        self.commit_model(&mut next, accrued)?;
        Ok(next)
    }

    /// Only current admission includes IM/reservations. The held-window safeguard
    /// independently preserves nonnegative risk equity at every mixed endpoint.
    pub(crate) fn held_solvent(&self, model: Margin) -> Result<()> {
        for btc in self.bounds[0] {
            for eth in self.bounds[1] {
                let mut risks = self.risks;
                risks[0].funding = btc;
                risks[1].funding = eth;
                require!(
                    checked(model.risk_equity(risks))? >= 0,
                    ClearingError::ExitCohort
                );
            }
        }
        Ok(())
    }

    pub(crate) fn claims(&self, model: Margin) -> Result<[i128; 2]> {
        checked(model.claims(
            self.markets.each_ref().map(|market| {
                market
                    .as_ref()
                    .map_or(1, |market| market.reference_price.max(1))
            }),
            self.risks.map(|risk| risk.funding),
        ))
    }
}

pub(crate) fn advance(root: &mut MarginAccount) -> Result<()> {
    increment(&mut root.nonce)?;
    increment(&mut root.state_version)
}

pub(crate) fn withdraw_candidate(
    root: &MarginAccount,
    snapshot: &Snapshot,
    amount: u64,
) -> Result<Box<MarginAccount>> {
    require!(amount > 0, ClearingError::Amount);
    let mut next = snapshot.refresh(root, true)?;
    let accrued = crate::engine::account::model(&next)?;
    #[cfg(feature = "indexed-withdrawal")]
    let candidate = indexed_cash_outflow(accrued, snapshot, amount)?;
    #[cfg(not(feature = "indexed-withdrawal"))]
    let candidate = {
        let candidate = checked(accrued.withdraw(amount, snapshot.risks))?;
        snapshot.held_solvent(candidate)?;
        candidate
    };
    snapshot.commit_model(&mut next, candidate)?;
    advance(&mut next)?;
    Ok(next)
}

/// The root has already accrued funding and refreshed every active order. The
/// account context binds each supplied market PDA to its slot on this venue.
#[cfg(feature = "indexed-withdrawal")]
fn indexed_cash_outflow(mut accrued: Margin, snapshot: &Snapshot, amount: u64) -> Result<Margin> {
    use math::withdrawal::{cash_required, MarketWindow, OccupiedSlot};

    let mut slots = Vec::with_capacity(accrued.positions.len());
    let mut windows = Vec::with_capacity(accrued.positions.len());
    for (index, position) in accrued.positions.iter().enumerate() {
        if position.lots == 0 && position.virtual_scaled == 0 {
            continue;
        }
        let market = u16::from(snapshot.market(index)?.index);
        slots.push(OccupiedSlot { market, position: *position });
        if position.lots != 0 {
            let [funding_low, funding_high] = snapshot.bounds[index];
            windows.push(MarketWindow { market, current: snapshot.risks[index], funding_low, funding_high });
        }
    }
    accrued.cash = checked(math::cash_sub(accrued.cash, amount))?;
    let remaining = checked(math::scaled(accrued.cash))?;
    let required = checked(cash_required(&slots, &windows, accrued.reserved))?;
    require!(remaining >= required.current_scaled, ClearingError::Arithmetic);
    require!(remaining >= required.held_scaled, ClearingError::ExitCohort);
    Ok(accrued)
}

pub(crate) fn receive_candidate(
    root: &MarginAccount,
    snapshot: &Snapshot,
    amount: u64,
) -> Result<Box<MarginAccount>> {
    require!(amount > 0, ClearingError::Amount);
    // A recipient can receive cash while unhealthy/stale. Consume its funded
    // interval without granting trading authority or requiring new credit.
    let mut next = snapshot.refresh(root, false)?;
    next.cash = checked(math::cash_add(next.cash, amount))?;
    advance(&mut next)?;
    Ok(next)
}

pub(crate) fn claim_candidate(
    root: &MarginAccount,
    snapshot: &Snapshot,
    market: usize,
    amount: u64,
    gain: bool,
    pool: u64,
) -> Result<(Box<MarginAccount>, u64)> {
    require!(market < 2 && amount > 0, ClearingError::Amount);
    snapshot.market(market)?;
    let mut next = snapshot.refresh(root, true)?;
    let model = crate::engine::account::model(&next)?;
    require!(model.allows(market), ClearingError::Profile);
    let claims = snapshot.claims(model)?;
    let booked = math::settlement::book_claim(&model, claims, market, amount, gain, pool)
        .map_err(|error| ProgramError::from(match error {
            math::Error::Entitlement => ClearingError::Amount,
            math::Error::Cohort => ClearingError::ExitCohort,
            _ => ClearingError::Arithmetic,
        }))?;
    next.cash = booked.cash;
    next.positions[market].virtual_scaled = booked.virtual_scaled;
    if gain {
        checked(crate::engine::account::model(&next)?.admissible(snapshot.risks))?;
    }
    advance(&mut next)?;
    Ok((next, booked.pool))
}

pub(crate) fn net_candidate(
    root: &MarginAccount,
    snapshot: &Snapshot,
    source: usize,
    amount: u64,
    pools: [u64; 2],
) -> Result<(Box<MarginAccount>, [u64; 2])> {
    require!(
        source < 2 && amount > 0 && root.mode == MODE_CROSS,
        ClearingError::Amount
    );
    snapshot.market(0)?;
    snapshot.market(1)?;
    let mut next = snapshot.refresh(root, false)?;
    require!(
        next.positions.iter().all(|position| position.lots == 0)
            && next.book.orders.iter().all(|entry| !entry.order.active()),
        ClearingError::OrderState
    );
    // Cancelled/invalidated protections retain historical allowance records.
    // Execution authority lives in active orders, already refreshed above;
    // an inert historical record must not permanently block flat settlement.
    let destination = 1 - source;
    let scaled = checked(math::scaled(amount))?;
    require!(
        next.positions[source].virtual_scaled >= scaled
            && next.positions[destination].virtual_scaled <= -scaled
            && pools[source] >= amount,
        ClearingError::Amount
    );
    next.positions[source].virtual_scaled =
        subtract(next.positions[source].virtual_scaled, scaled)?;
    next.positions[destination].virtual_scaled =
        add(next.positions[destination].virtual_scaled, scaled)?;
    let mut result = pools;
    result[source] = checked(math::cash_sub(result[source], amount))?;
    result[destination] = checked(math::cash_add(result[destination], amount))?;
    advance(&mut next)?;
    Ok((next, result))
}

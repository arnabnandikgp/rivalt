//! Permissionless maker reduction on an active local clearing market.
use super::*;
use crate::engine::{account, book, checked, risk};

pub(super) struct Health {
    equity: i128,
    deficit: i128,
}

impl Health {
    fn read(target: &MarginAccount, environment: &book::Environment) -> Result<Self> {
        let model = account::model(target)?;
        let risks = environment.risks();
        Ok(Self {
            equity: checked(model.risk_equity(risks))?,
            deficit: checked(model.deficit(risks))?,
        })
    }

    pub(super) fn check_progress(
        &self,
        filled: &MarginAccount,
        environment: &book::Environment,
        lots: u64,
    ) -> Result<()> {
        let after = Self::read(filled, environment)?;
        // A keeper can trim in bulk while the target remains below maintenance.
        // The final single lot prevents a caller from liquidating past recovery.
        require!(
            after.deficit < self.deficit
                && after.equity >= self.equity
                && (after.deficit > 0 || lots == 1),
            ClearingError::Liquidation
        );
        Ok(())
    }
}

pub(super) fn prepare(
    target: &mut MarginAccount,
    environment: &book::Environment,
    clock: &Clock,
) -> Result<Health> {
    book::validate(target)?;
    environment.admit_sources(target, clock, true)?;
    let before = Health::read(target, environment)?;
    require!(
        before.deficit > 0 && before.equity >= 0,
        ClearingError::Liquidation
    );
    risk::cancel_risk_increasing_orders(target);
    book::refresh_with_environment(target, environment)?;
    Ok(before)
}

pub(super) fn check_price(quote: &canonical::MakerQuoteResponse, market: &Market) -> Result<()> {
    let gross = u128::from(quote.gross);
    let lots = u128::from(quote.request.lots);
    let within_bound = match quote.request.side {
        0 => gross <= lots * u128::from(market.upper),
        1 => gross >= lots * u128::from(market.lower),
        _ => false,
    };
    require!(within_bound, ClearingError::RouteLimit);
    Ok(())
}

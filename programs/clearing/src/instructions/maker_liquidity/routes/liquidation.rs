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
            financial_core::liquidation::maker_progress(self.equity, self.deficit, after.equity, after.deficit, lots),
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
    // The target is a candidate copy. Only a completed fill can persist cancellation.
    risk::cancel_risk_increasing_orders(target);
    book::refresh_with_environment(target, environment)?;
    environment.admit_sources(target, clock, true)?;
    let before = Health::read(target, environment)?;
    require!(
        before.deficit > 0 && before.equity >= 0,
        ClearingError::Liquidation
    );
    Ok(before)
}

pub(super) fn check_price(quote: &canonical::MakerQuoteResponse, market: &Market) -> Result<()> {
    let within_bound = financial_core::liquidation::maker_price(
        quote.request.side, quote.request.lots, quote.gross, market.lower, market.upper,
    );
    require!(within_bound, ClearingError::RouteLimit);
    Ok(())
}

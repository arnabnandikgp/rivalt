//! Account-local funded exits and market-specific normal claim settlement.
use super::account_custody::{arithmetic as checked, increment};
use super::account_trading as trading;
use crate::{
    error::ClearingError,
    state::{accounts::*, records::*},
};
use anchor_lang::prelude::*;
use financial_core as math;

mod engine;
pub(crate) use engine::*;
mod contexts;
pub use contexts::*;
pub mod cash;
pub mod certificate;
pub mod claims;
pub mod fees;
#[cfg(test)]
mod tests;

fn add(left: i128, right: i128) -> Result<i128> {
    left.checked_add(right)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}
fn subtract(left: i128, right: i128) -> Result<i128> {
    left.checked_sub(right)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}

pub(crate) fn profile(venue: &Venue, safety: &VenueSafety) -> Result<()> {
    trading::activated_identity(venue, safety)
}

fn begin(identity: &AccountFinancialIdentity) -> Result<Snapshot> {
    profile(&identity.venue, &identity.safety)?;
    Snapshot::optional(identity.markets(), &Clock::get()?)
}

fn commit(
    root: &mut Account<MarginAccount>,
    candidate: &MarginAccount,
    ledgers: [Option<&mut MarketLedger>; 2],
) -> Result<()> {
    let previous = root.positions;
    trading::invalidate(ledgers, previous, candidate.positions)?;
    trading::commit_root(root, candidate)
}

fn finish(identity: &mut AccountFinancialIdentity, clock: &Clock) -> Result<()> {
    identity.materialize(clock)
}

#[inline(never)]
fn emit<'info>(
    identity: &AccountFinancialIdentity<'info>,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountInfo<'info>,
    actor: Pubkey,
    kind: u8,
    market_index: u8,
    amount: u64,
    roots: &[&Account<'info, MarginAccount>],
    ledgers: &[&Account<'info, MarketLedger>],
    tokens: Option<(u64, u64)>,
    slot: u64,
) -> Result<()> {
    let event = Box::new(crate::events::AccountFinancialChanged {
        venue: identity.venue.key(),
        slot,
        actor,
        kind,
        market_index,
        amount,
        safety_epoch: identity.safety.epoch,
        allocated_vault: tokens.map(|value| value.0),
        actual_vault: tokens.map(|value| value.1),
        roots: roots.iter().map(|root| root.key()).collect(),
        root_states: roots
            .iter()
            .map(|root| crate::events::MarginAccountSnapshot::from(&***root))
            .collect(),
        markets: identity
            .markets()
            .into_iter()
            .flatten()
            .map(crate::events::MarketSnapshot::from)
            .collect(),
        ledgers: ledgers
            .iter()
            .map(|ledger| super::account_custody::ledger_snapshot(ledger))
            .collect(),
    });
    events.emit(&*event, authority)
}

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

pub(crate) fn profile(venue: &Venue, custody: &Custody, safety: &VenueSafety) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification"),
        ClearingError::Profile
    );
    trading::activated(venue, custody, safety)
}

fn begin(identity: &AccountFinancialIdentity) -> Result<Snapshot> {
    profile(&identity.venue, &identity.custody, &identity.safety)?;
    super::account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )?;
    Snapshot::new([&identity.btc, &identity.eth], &Clock::get()?)
}

fn commit(
    identity: &mut AccountFinancialIdentity,
    root: &mut Account<MarginAccount>,
    candidate: &MarginAccount,
) -> Result<()> {
    let previous = root.positions;
    trading::commit_root(root, candidate)?;
    trading::invalidate(&mut identity.custody, previous, root.positions)
}

fn finish(identity: &mut AccountFinancialIdentity, clock: &Clock) -> Result<()> {
    trading::materialize([&mut identity.btc, &mut identity.eth], clock)?;
    increment(&mut identity.custody.sequence)?;
    super::account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )
}

#[inline(never)]
fn emit<'info>(
    identity: &AccountFinancialIdentity<'info>,
    authority: AccountInfo<'info>,
    actor: Pubkey,
    kind: u8,
    market_index: u8,
    amount: u64,
    roots: &[&Account<'info, MarginAccount>],
    slot: u64,
) -> Result<()> {
    let event = Box::new(crate::events::AccountFinancialChanged {
        venue: identity.venue.key(),
        sequence: identity.custody.sequence,
        slot,
        actor,
        kind,
        market_index,
        amount,
        safety_epoch: identity.safety.epoch,
        total_cash: identity.custody.total_cash,
        allocated_vault: identity.custody.allocated_vault,
        actual_vault: identity.vault.amount,
        liability_versions: identity.custody.liability_versions,
        roots: roots.iter().map(|root| root.key()).collect(),
        root_states: roots
            .iter()
            .map(|root| crate::events::MarginAccountSnapshot::from(&***root))
            .collect(),
        markets: [
            crate::events::MarketSnapshot::from(&**identity.btc),
            crate::events::MarketSnapshot::from(&**identity.eth),
        ],
        ledgers: [&identity.btc_ledger, &identity.eth_ledger].map(|ledger| {
            crate::events::MarketLedgerSnapshot {
                ledger: ledger.key(),
                market: ledger.market,
                market_index: ledger.market_index,
                settlement: ledger.settlement,
                insurance: ledger.insurance,
                fees: ledger.fees,
                insurance_fee_remainder: ledger.insurance_fee_remainder,
                version: ledger.version,
            }
        }),
    });
    crate::event_cpi::emit(&*event, authority)
}

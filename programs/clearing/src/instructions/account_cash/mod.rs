//! Account-local funded exits and market-specific normal claim settlement.
use super::account_custody::{arithmetic as checked, increment};
use super::account_trading as trading;
use crate::{
    error::ClearingError,
    state::{v2, v3::*},
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

pub(crate) fn profile(venue: &VenueV3, custody: &CustodyV3, safety: &SafetyV3) -> Result<()> {
    require!(
        cfg!(feature = "account-cash-qualification"),
        ClearingError::Profile
    );
    trading::financial_activated(venue, custody, safety)
}

fn begin(identity: &AccountFinancialIdentityV3) -> Result<Snapshot> {
    profile(&identity.venue, &identity.custody, &identity.safety)?;
    super::account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )?;
    Snapshot::new([&identity.btc, &identity.eth], &Clock::get()?)
}

fn commit(
    identity: &mut AccountFinancialIdentityV3,
    root: &mut Account<MarginAccountV3>,
    candidate: &v2::MarginAccountV2,
) -> Result<()> {
    let previous = root.positions;
    trading::commit_root(root, candidate)?;
    trading::invalidate(&mut identity.custody, previous, root.positions)
}

fn finish(identity: &mut AccountFinancialIdentityV3, clock: &Clock) -> Result<()> {
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
    identity: &AccountFinancialIdentityV3<'info>,
    authority: AccountInfo<'info>,
    actor: Pubkey,
    kind: u8,
    market_index: u8,
    amount: u64,
    roots: &[&Account<'info, MarginAccountV3>],
    slot: u64,
) -> Result<()> {
    let event = Box::new(crate::events::AccountFinancialChangedV3 {
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
            .map(|root| crate::events::MarginAccountSnapshotV3::from(&***root))
            .collect(),
        markets: [
            crate::events::MarketSnapshotV3::from(&**identity.btc),
            crate::events::MarketSnapshotV3::from(&**identity.eth),
        ],
        ledgers: [&identity.btc_ledger, &identity.eth_ledger].map(|ledger| {
            crate::events::MarketLedgerSnapshotV3 {
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

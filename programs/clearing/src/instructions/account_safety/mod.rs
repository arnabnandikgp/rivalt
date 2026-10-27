//! Complete schema-3 safety in the explicit qualified local profile.
//! Default/devnet builds cannot activate these financial paths.
use super::{account_cash, account_custody, account_trading};
use crate::{error::ClearingError, state::v3::*};
use anchor_lang::prelude::*;

pub mod risk;
pub mod resolution;

fn candidate_profile(identity: &account_cash::AccountFinancialIdentityV3) -> Result<()> {
    require!(
        cfg!(feature = "account-safety-qualification"),
        ClearingError::Profile
    );
    account_cash::profile(&identity.venue, &identity.custody, &identity.safety)?;
    account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )
}

#[cfg(test)]
mod tests;

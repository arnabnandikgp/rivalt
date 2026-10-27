//! Schema-3 account risk and trading in explicit local qualification profiles.
//! P26's complete safety profile uses storage-ready authority activation.
pub(crate) use super::account_custody::{arithmetic as checked, increment};
use super::group_trading::{book, oracle as shared_oracle};
use crate::{
    error::ClearingError,
    state::{v2, v3::*},
};
use anchor_lang::prelude::*;
use financial_core as math;
mod engine;
pub(crate) use engine::*;

pub(crate) fn base_profile(venue: &VenueV3, custody: &CustodyV3, safety: &SafetyV3) -> Result<()> {
    require!(
        cfg!(feature = "account-trading-qualification")
            && venue.schema_version == SCHEMA_VERSION
            && venue.profile_version == PROFILE_VERSION
            && venue.market_count == 2
            && venue.insurance_fee_share_bps == 2500
            && custody.schema_version == SCHEMA_VERSION
            && safety.schema_version == SCHEMA_VERSION
            && matches!(safety.mode, CUSTODY | ACTIVE),
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn profile(venue: &VenueV3, custody: &CustodyV3, safety: &SafetyV3) -> Result<()> {
    base_profile(venue, custody, safety)?;
    require!(!safety.paused, ClearingError::Paused);
    Ok(())
}

pub(crate) fn activated(venue: &VenueV3, custody: &CustodyV3, safety: &SafetyV3) -> Result<()> {
    profile(venue, custody, safety)?;
    require!(safety.mode == ACTIVE, ClearingError::Profile);
    Ok(())
}

pub mod makers;

pub mod oracle;

pub mod authority;

pub mod routes;

pub mod activation;

#[cfg(test)]
mod tests;

//! Schema-3 account risk and trading in explicit local qualification profiles.
//! P26's complete safety profile uses storage-ready authority activation.
pub(crate) use super::account_custody::{arithmetic as checked, increment};
use crate::engine::{book, oracle as shared_oracle};
use crate::{
    error::ClearingError,
    state::{accounts::*, records::*},
};
use anchor_lang::prelude::*;
use financial_core as math;
mod engine;
pub(crate) use engine::*;

/// The only supported fresh local financial profile.
pub(crate) fn supported_profile(venue: &Venue) -> bool {
    venue.profile_version == PROFILE_VERSION
}

pub(crate) fn base_profile(venue: &Venue, custody: &Custody, safety: &VenueSafety) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && venue.schema_version == SCHEMA_VERSION
            && supported_profile(venue)
            && venue.market_count == 2
            && venue.insurance_fee_share_bps == 2500
            && custody.schema_version == SCHEMA_VERSION
            && safety.schema_version == SCHEMA_VERSION
            && matches!(safety.mode, CUSTODY | ACTIVE),
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn activated(venue: &Venue, custody: &Custody, safety: &VenueSafety) -> Result<()> {
    base_profile(venue, custody, safety)?;
    require!(!safety.paused, ClearingError::Paused);
    require!(safety.mode == ACTIVE, ClearingError::Profile);
    Ok(())
}

pub mod contexts;
pub use contexts::*;

pub mod oracle;

pub mod authority;

pub mod activation;

#[cfg(test)]
mod tests;

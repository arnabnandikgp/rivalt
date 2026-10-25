//! Successor trading primitives. P18C supplies local-only isolated safety; cross remains gated.
pub(crate) use super::group_margin::{commit_model, model};
use crate::{error::ClearingError, state::v2::*};
use anchor_lang::prelude::*;
use financial_core as math;

pub mod book;
pub mod makers;
pub mod oracle;
pub mod routes;

pub(crate) fn checked<T>(value: math::Result<T>) -> Result<T> {
    value.map_err(|_| error!(ClearingError::Arithmetic))
}

pub(crate) fn profile(group: &ClearingGroupV2) -> Result<()> {
    require!(
        cfg!(feature = "successor-test-profile")
            && group.schema_version == SCHEMA_VERSION
            && group.profile_version == PROFILE_VERSION
            && group.market_count == 2
            && (group.mode <= 1 || (cross_profile_enabled() && group.mode == 2)),
        ClearingError::Profile
    );
    require!(!group.paused, ClearingError::Paused);
    Ok(())
}

pub(crate) fn activated(group: &ClearingGroupV2) -> Result<()> {
    profile(group)?;
    require!(
        ISOLATED_TRADING_IMPLEMENTED
            && (group.mode == 1 || (cross_profile_enabled() && group.mode == 2)),
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn risk(market: &GroupMarketV2, funding: i128) -> Result<[math::margin::Risk; 2]> {
    require!(
        market.index < 2 && market.schema_version == SCHEMA_VERSION,
        ClearingError::Profile
    );
    let mut risks = [math::margin::Risk::default(); 2];
    risks[usize::from(market.index)] = math::margin::Risk {
        lower: market.lower,
        upper: market.upper,
        funding,
    };
    Ok(risks)
}

pub(crate) fn advance(root: &mut MarginAccountV2) -> Result<()> {
    root.state_version = root
        .state_version
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(())
}

#[cfg(test)]
mod tests;

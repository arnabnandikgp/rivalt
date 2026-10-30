//! Successor trading primitives. P18C supplies local-only isolated safety; cross remains gated.
pub(crate) use crate::engine::{checked, risk, advance};
pub(crate) use super::group_margin::model;
use crate::{error::ClearingError, state::v2::*};
use anchor_lang::prelude::*;
use financial_core as math;

pub(crate) use crate::engine::book;
pub mod makers;
pub mod oracle;
pub mod routes;



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





#[cfg(test)]
mod tests;

//! Successor trading primitives. Financial entrypoints stay closed until P18C safety acceptance.
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
            && group.mode <= 1,
        ClearingError::Profile
    );
    require!(!group.paused, ClearingError::Paused);
    Ok(())
}

pub(crate) fn activated(group: &ClearingGroupV2) -> Result<()> {
    profile(group)?;
    require!(
        ISOLATED_TRADING_IMPLEMENTED && group.mode == 1,
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn model(root: &MarginAccountV2) -> Result<math::margin::Margin> {
    require!(
        root.schema_version == SCHEMA_VERSION
            && root.mode == MODE_ISOLATED
            && root.subaccount_index > 0
            && root.subaccount_index <= MAX_SUBACCOUNT
            && root.role <= ROLE_RECEIVER
            && usize::from(root.isolated_market_index) < MARKET_COUNT
            && root.delegate == Pubkey::default()
            && root.delegate_expiry_slot == 0
            && root.delegate_epoch == 1,
        ClearingError::Profile
    );
    let model = math::margin::Margin {
        id: root.id,
        mode: math::margin::Mode::Isolated(usize::from(root.isolated_market_index)),
        cash: root.cash,
        reserved: root.reserved,
        positions: root.positions.map(|position| math::margin::Position {
            lots: position.lots,
            virtual_scaled: position.virtual_scaled,
            funding_checkpoint: position.funding_checkpoint_scaled,
            generation: position.generation,
        }),
    };
    checked(model.validate())?;
    Ok(model)
}

pub(crate) fn commit_model(root: &mut MarginAccountV2, model: math::margin::Margin) -> Result<()> {
    require!(
        model.id == root.id
            && model.mode == math::margin::Mode::Isolated(usize::from(root.isolated_market_index)),
        ClearingError::Profile
    );
    checked(model.validate())?;
    root.cash = model.cash;
    root.positions = model.positions.map(|position| PositionV2 {
        lots: position.lots,
        virtual_scaled: position.virtual_scaled,
        funding_checkpoint_scaled: position.funding_checkpoint,
        generation: position.generation,
    });
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

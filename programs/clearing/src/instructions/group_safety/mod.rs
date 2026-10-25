//! Group-wide solvency, guarded exits and frozen complete-cohort recovery.
use crate::instructions::{group_custody, group_trading};
use crate::{error::ClearingError, state::v2::*};
use anchor_lang::prelude::*;
use financial_core as math;
use group_trading::{checked, oracle};

pub mod resolution;
pub mod risk;
pub mod settlement;

pub(crate) fn next(value: u64) -> Result<u64> {
    value
        .checked_add(1)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}

/// Include every mode in the cohort. Until the cross release gate qualifies,
/// cross identities may hold cash but not exposure, claims or order authority.
pub(crate) fn account_model(root: &MarginAccountV2) -> Result<math::margin::Margin> {
    let model = crate::instructions::group_margin::model(root)?;
    if root.mode == MODE_ISOLATED || cross_profile_enabled() {
        return Ok(model);
    }
    require!(
        root.schema_version == SCHEMA_VERSION
            && valid_identity(
                0,
                root.subaccount_index,
                root.mode,
                root.isolated_market_index,
                root.role
            )
            && root.mode == MODE_CROSS
            && root.reserved == 0
            && root.positions.iter().all(|position| position.lots == 0
                && position.virtual_scaled == 0
                && position.generation == 0)
            && root
                .book
                .orders
                .iter()
                .all(|entry| !entry.order.active() && entry.order.reserve == 0)
            && root
                .book
                .protections
                .iter()
                .all(|entry| entry.protection.remaining == 0),
        ClearingError::Profile
    );
    Ok(model)
}

pub(crate) fn commit(root: &mut MarginAccountV2, model: math::margin::Margin) -> Result<()> {
    let previous = account_model(root)?;
    require!(
        previous.id == model.id && previous.mode == model.mode,
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
    account_model(root)?;
    root.state_version = next(root.state_version)?;
    Ok(())
}

pub(crate) fn markets(
    group: &ClearingGroupV2,
    group_key: Pubkey,
    markets: [&Account<GroupMarketV2>; 2],
) -> Result<()> {
    for (index, market) in markets.into_iter().enumerate() {
        require!(
            market.schema_version == SCHEMA_VERSION
                && market.group == group_key
                && usize::from(market.index) == index
                && group.markets[index] == market.key()
                && market.lots_per_unit == [1_000_000, 100_000][index],
            ClearingError::Profile
        );
    }
    Ok(())
}

pub(crate) fn risks(
    mode: u8,
    markets: [&GroupMarketV2; 2],
    clock: &Clock,
) -> Result<[math::margin::Risk; 2]> {
    let mut result = [math::margin::Risk::default(); 2];
    for (index, market) in markets.into_iter().enumerate() {
        result[index] = math::margin::Risk {
            lower: market.lower.max(1),
            upper: market.upper.max(1),
            funding: oracle::effective(mode, market, clock)?,
        };
    }
    Ok(result)
}

pub(crate) fn refresh(
    root: &mut MarginAccountV2,
    markets: [&GroupMarketV2; 2],
    mode: u8,
    clock: &Clock,
) -> Result<()> {
    account_model(root)?;
    let environment = group_trading::book::Environment {
        markets: markets.map(Some),
        selected: if root.mode == MODE_CROSS {
            0
        } else {
            usize::from(root.isolated_market_index)
        },
        funding: risks(mode, markets, clock)?.map(|risk| risk.funding),
        slot: clock.slot,
        credible: markets.map(|market| oracle::action(market, clock, false).is_ok()),
    };
    group_trading::book::refresh_with_environment(root, &environment)
}

pub(crate) fn registry_hash(registry: &GroupRegistryV2) -> Result<[u8; 32]> {
    require!(
        registry.schema_version == SCHEMA_VERSION
            && registry.count > 0
            && usize::from(registry.count) == registry.members.len()
            && registry.members.len() <= MAX_MEMBERS,
        ClearingError::Resolution
    );
    Ok(solana_sha256_hasher::hashv(
        &registry
            .members
            .iter()
            .map(|member| member.as_ref())
            .collect::<Vec<_>>(),
    )
    .to_bytes())
}

#[inline(never)]
pub(crate) fn member(
    info: &AccountInfo,
    group: Pubkey,
    registry: &GroupRegistryV2,
    id: usize,
    writable: bool,
) -> Result<MarginAccountV2> {
    require!(
        info.owner == &crate::ID
            && registry.members.get(id) == Some(info.key)
            && info.is_writable == writable
            && info.data_len() == 8 + MarginAccountV2::INIT_SPACE,
        ClearingError::Resolution
    );
    let root = MarginAccountV2::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require!(
        root.group == group && usize::from(root.id) == id,
        ClearingError::Resolution
    );
    let address = Pubkey::create_program_address(
        &[
            b"margin-v2",
            root.portfolio.as_ref(),
            &root.subaccount_index.to_le_bytes(),
            &[root.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| error!(ClearingError::Resolution))?;
    require_keys_eq!(address, *info.key, ClearingError::Resolution);
    account_model(&root)?;
    Ok(root)
}

#[cfg(test)]
mod tests;

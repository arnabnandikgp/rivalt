//! Shared root identity, dependencies and trade authority for both margin modes.
//! Cross entrypoints stay release-gated separately from candidate arithmetic.
use super::group_trading::checked;
use crate::{error::ClearingError, state::v2::*};
use anchor_lang::prelude::*;
use financial_core as math;

pub(crate) fn model(root: &MarginAccountV2) -> Result<math::margin::Margin> {
    require!(
        root.schema_version == SCHEMA_VERSION
            && valid_identity(
                0,
                root.subaccount_index,
                root.mode,
                root.isolated_market_index,
                root.role
            )
            && root.delegate_epoch > 0
            && ((root.delegate == Pubkey::default()) == (root.delegate_expiry_slot == 0))
            && (root.delegate == Pubkey::default() || root.delegate != root.owner),
        ClearingError::Profile
    );
    let model = math::margin::Margin {
        id: root.id,
        mode: if root.mode == MODE_CROSS {
            math::margin::Mode::Cross
        } else {
            math::margin::Mode::Isolated(usize::from(root.isolated_market_index))
        },
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

pub(crate) fn commit_model(
    root: &mut MarginAccountV2,
    candidate: math::margin::Margin,
) -> Result<()> {
    let previous = model(root)?;
    require!(
        candidate.id == previous.id && candidate.mode == previous.mode,
        ClearingError::Profile
    );
    checked(candidate.validate())?;
    root.cash = candidate.cash;
    root.reserved = candidate.reserved;
    root.positions = candidate.positions.map(|position| PositionV2 {
        lots: position.lots,
        virtual_scaled: position.virtual_scaled,
        funding_checkpoint_scaled: position.funding_checkpoint,
        generation: position.generation,
    });
    Ok(())
}

pub(crate) fn trading(group: &ClearingGroupV2, root: &MarginAccountV2) -> Result<()> {
    super::group_trading::profile(group)?;
    model(root)?;
    require!(
        match root.mode {
            MODE_ISOLATED =>
                ISOLATED_TRADING_IMPLEMENTED
                    && (group.mode == 1 || (CROSS_TRADING_IMPLEMENTED && group.mode == 2)),
            MODE_CROSS => CROSS_TRADING_IMPLEMENTED && group.mode == 2,
            _ => false,
        },
        ClearingError::Profile
    );
    Ok(())
}

/// Zero identifies owner-created durable authority. The live delegate grant is
/// scoped to this root and expires exclusively at its stored slot.
pub(crate) fn trade_authority(root: &MarginAccountV2, actor: Pubkey, slot: u64) -> Result<u64> {
    model(root)?;
    if actor == root.owner {
        return Ok(0);
    }
    require!(
        actor != Pubkey::default() && actor == root.delegate && slot < root.delegate_expiry_slot,
        ClearingError::Authority
    );
    Ok(root.delegate_epoch)
}

pub(crate) fn live_order_authority(root: &MarginAccountV2, epoch: u64, slot: u64) -> bool {
    epoch == 0
        || (epoch == root.delegate_epoch
            && root.delegate != Pubkey::default()
            && slot < root.delegate_expiry_slot)
}

/// Authenticate the fixed full-account universe, not a keeper-selected subset.
/// Typed Anchor accounts enforce the program owner before this helper is called.
pub(crate) fn markets<'a>(
    group: &ClearingGroupV2,
    group_key: Pubkey,
    dependencies: &[(Pubkey, &'a GroupMarketV2)],
) -> Result<[&'a GroupMarketV2; MARKET_COUNT]> {
    require!(
        group.schema_version == SCHEMA_VERSION
            && group.market_count == 2
            && dependencies.len() == 2,
        ClearingError::Profile
    );
    for (index, (key, market)) in dependencies.iter().enumerate() {
        let canonical = Pubkey::find_program_address(
            &[b"market-v2", group_key.as_ref(), &[index as u8]],
            &crate::ID,
        )
        .0;
        require!(
            *key == canonical
                && group.markets[index] == canonical
                && market.schema_version == SCHEMA_VERSION
                && market.group == group_key
                && usize::from(market.index) == index
                && market.lots_per_unit == [1_000_000, 100_000][index],
            ClearingError::Profile
        );
    }
    Ok([dependencies[0].1, dependencies[1].1])
}

#[cfg(test)]
mod tests;

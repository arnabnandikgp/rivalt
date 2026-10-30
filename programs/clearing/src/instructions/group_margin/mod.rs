//! Shared root identity, dependencies and trade authority for both margin modes.
//! Cross entrypoints stay release-gated separately from candidate arithmetic.
pub(crate) use crate::engine::account::{model, commit_model, trade_authority};
use super::group_trading::checked;
use crate::{error::ClearingError, state::v2::*};
use anchor_lang::prelude::*;
#[cfg(test)]
use financial_core as math;

pub mod authority;
pub mod netting;
pub mod trading;

pub(crate) fn environment<'a>(
    group: &ClearingGroupV2,
    group_key: Pubkey,
    selected: &'a Account<GroupMarketV2>,
    other: &'a Account<GroupMarketV2>,
    sequence: u64,
    observations: [u64; 2],
    clock: &Clock,
) -> Result<super::group_trading::book::Environment<'a>> {
    require!(
        selected.index < 2 && group.sequence == sequence,
        ClearingError::Profile
    );
    let dependencies = if selected.index == 0 {
        [(selected.key(), &**selected), (other.key(), &**other)]
    } else {
        [(other.key(), &**other), (selected.key(), &**selected)]
    };
    let states = markets(group, group_key, &dependencies)?;
    require!(
        states.map(|market| market.observation_sequence) == observations,
        ClearingError::OraclePolicy
    );
    let oracle = super::group_trading::oracle::effective;
    Ok(super::group_trading::book::Environment {
        markets: states.map(Some),
        selected: usize::from(selected.index),
        funding: [
            oracle(group.mode, states[0], clock)?,
            oracle(group.mode, states[1], clock)?,
        ],
        slot: clock.slot,
        credible: states
            .map(|market| super::group_trading::oracle::action(market, clock, false).is_ok()),
    })
}





pub(crate) fn trading(group: &ClearingGroupV2, root: &MarginAccountV2) -> Result<()> {
    super::group_trading::profile(group)?;
    model(root)?;
    require!(
        match root.mode {
            MODE_ISOLATED =>
                ISOLATED_TRADING_IMPLEMENTED
                    && (group.mode == 1 || (cross_profile_enabled() && group.mode == 2)),
            MODE_CROSS => cross_profile_enabled() && group.mode == 2,
            _ => false,
        },
        ClearingError::Profile
    );
    Ok(())
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
mod financial_tests;
#[cfg(test)]
mod tests;

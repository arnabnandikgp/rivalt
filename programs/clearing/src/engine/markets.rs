//! Derive dependencies from authenticated account state, never a caller's mask.
use super::*;

pub(crate) fn required(root: &MarginAccount) -> Result<u8> {
    book::validate(root)?;
    dependency_mask(root)
}

fn dependency_mask(root: &MarginAccount) -> Result<u8> {
    let model = account::model(root)?;
    let mut mask = 0;
    for (index, position) in root.positions.iter().enumerate() {
        if position.lots != 0 || position.virtual_scaled != 0 {
            mask |= 1 << index;
        }
    }
    // Include stored active authority even when this action will expire/cancel it.
    // A historical protection record without an active child adds no dependency.
    for stored in &root.book.orders {
        if stored.order.active() {
            require!(model.allows(usize::from(stored.market_index)), ClearingError::OrderState);
            mask |= 1 << stored.market_index;
        }
    }
    Ok(mask)
}

pub(crate) fn validate(
    markets: [Option<&Market>; 2],
    roots: &[&MarginAccount],
    requested: u8,
) -> Result<()> {
    for root in roots {
        required(root)?;
    }
    validate_environment(markets, roots, requested)
}

/// Refresh may see a just-consumed order before its terminal reserve is cleared.
/// Validate dependencies there without requiring the old reserve sum to be final.
/// Public candidate boundaries separately validate the stored input book.
pub(crate) fn validate_environment(
    markets: [Option<&Market>; 2], roots: &[&MarginAccount], requested: u8,
) -> Result<()> {
    require!(requested & !3 == 0, ClearingError::OrderState);
    let mut required_mask = requested;
    for root in roots {
        required_mask |= dependency_mask(root)?;
        for (index, market) in markets.iter().enumerate() {
            if let Some(market) = market {
                require!(
                    market.schema_version == SCHEMA_VERSION
                        && market.venue == root.venue
                        && usize::from(market.index) == index,
                    ClearingError::OrderState
                );
            }
        }
    }
    for (index, market) in markets.iter().enumerate() {
        require!(required_mask & (1 << index) == 0 || market.is_some(), ClearingError::OrderState);
    }
    Ok(())
}

/// The fixed two-slot arithmetic engine needs valid prices even for zero exposure.
/// Callers must validate the complete dependency union before using these inputs.
pub(crate) fn empty_risk() -> math::margin::Risk {
    math::margin::Risk { lower: 1, upper: 1, funding: 0 }
}

/// A missing market may never mutate its position, including historical cursors.
pub(crate) fn commit_model(
    root: &mut MarginAccount,
    mut candidate: math::margin::Margin,
    markets: [Option<&Market>; 2],
) -> Result<()> {
    validate_environment(markets, &[root], 0)?;
    let previous = account::model(root)?;
    for (index, market) in markets.iter().enumerate() {
        if market.is_none() {
            require!(candidate.positions[index].lots == 0
                && candidate.positions[index].virtual_scaled == 0,
                ClearingError::OrderState);
            candidate.positions[index] = previous.positions[index];
        }
    }
    account::commit_model(root, candidate)
}

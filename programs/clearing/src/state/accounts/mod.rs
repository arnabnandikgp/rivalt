//! Schema-5 scoped layouts and the explicitly qualified local release marker.
//! Venue identity, account risk, market backing and exceptional safety are distinct.
use crate::state::{
    records::{OrderBook, Position},
    OracleState,
};
use anchor_lang::prelude::*;

mod listings;
pub use listings::*;
mod layouts;
mod backing;
mod membership;
mod prepared_settlement;
mod recovery_storage;
mod resolution;
mod settlement;
mod settlement_plan;
mod settlement_rates;
pub use layouts::*;
pub use backing::*;
pub use membership::*;
pub use prepared_settlement::*;
pub use recovery_storage::*;
pub use resolution::*;
pub use settlement::*;
pub use settlement_plan::*;
pub use settlement_rates::*;

/// The candidate adds an authenticated tail after the fixed Borsh prefix.
pub const MARGIN_PREFIX: usize = 8 + MarginAccount::INIT_SPACE;
#[cfg(feature = "bounded-entry-settlement")]
pub const INITIAL_ATTRIBUTION_BYTES: usize = clearing_accounting::entry_cost::EntryCost::BYTES;
#[cfg(all(feature = "profit-attribution-qualification", not(feature = "bounded-entry-settlement")))]
pub const INITIAL_ATTRIBUTION_BYTES: usize = 128;
pub const MARGIN_ALLOCATION: usize = MARGIN_PREFIX + {
    #[cfg(feature = "profit-attribution-qualification")]
    { 8 + 2 * INITIAL_ATTRIBUTION_BYTES }
    #[cfg(not(feature = "profit-attribution-qualification"))]
    { 0 }
};

/// The local qualification probes prove this range on the pinned SBF executable.
#[cfg(feature = "profit-attribution-qualification")]
pub const MAX_ATTRIBUTION_SLOT: usize = 256;
#[cfg(feature = "profit-attribution-qualification")]
pub const RENT_CREDIT_BYTES: usize = 32 + 8;

pub fn valid_margin_size(size: usize) -> bool {
    if size == MARGIN_ALLOCATION { return true; }
    #[cfg(all(feature = "profit-attribution-qualification", not(feature = "bounded-entry-settlement")))]
    if let Some(extra) = size.checked_sub(MARGIN_ALLOCATION + RENT_CREDIT_BYTES) {
        return extra > 0 && extra % 2 == 0 &&
            extra / 2 <= MAX_ATTRIBUTION_SLOT - INITIAL_ATTRIBUTION_BYTES;
    }
    false
}

pub const SCHEMA_VERSION: u16 = 10;
pub const PROFILE_VERSION: u16 = 6;
pub use crate::state::identity::MARKET_COUNT;
pub const RESOLUTION_PAGE_ROWS: usize = 2;
pub const WIDE_LIMBS: usize = 96;
pub const TRADING_IMPLEMENTED: bool = cfg!(feature = "liquidity-execution-qualification");

pub const CUSTODY: u8 = 0;
pub const ACTIVE: u8 = 1;
pub const FROZEN: u8 = 2;
pub const RESOLVED: u8 = 3;
pub const RETIRED: u8 = 4;

/// Identity indices have the same user meaning as V2, but distinct PDA roots.
pub use crate::state::identity::{
    valid_identity, CROSS_MARKET_SENTINEL, LISTED_CAPITAL_TAG, MAX_PORTFOLIOS, MAX_SUBACCOUNT, MODE_CROSS,
    MODE_ISOLATED, ROLE_MAKER, ROLE_RECEIVER, ROLE_TRADER,
};

#[cfg(test)]
mod tests;

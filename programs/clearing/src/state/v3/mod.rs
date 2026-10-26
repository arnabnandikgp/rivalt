//! Schema-3 contract layouts. P22B supplies no entrypoints or activation.
//! Venue identity, account risk, market backing and exceptional safety are distinct.
use crate::state::{
    v2::{OrderBookV2, PositionV2},
    OracleState,
};
use anchor_lang::prelude::*;

mod accounts;
mod resolution;
pub use accounts::*;
pub use resolution::*;

pub const SCHEMA_VERSION: u16 = 3;
pub const PROFILE_VERSION: u16 = 3;
pub const MARKET_COUNT: usize = 2;
pub const MAX_MEMBERS: usize = 64;
pub const RESOLUTION_PAGE_ROWS: usize = 2;
pub const WIDE_LIMBS: usize = 96;
pub const TRADING_IMPLEMENTED: bool = false;

pub const CUSTODY: u8 = 0;
pub const ACTIVE: u8 = 1;
pub const FROZEN: u8 = 2;
pub const RESOLVED: u8 = 3;
pub const RETIRED: u8 = 4;

/// Identity indices have the same user meaning as V2, but distinct PDA roots.
pub use crate::state::v2::{
    valid_identity, CROSS_MARKET_SENTINEL, MAX_PORTFOLIOS, MAX_SUBACCOUNT, MODE_CROSS,
    MODE_ISOLATED, ROLE_MAKER, ROLE_RECEIVER, ROLE_TRADER,
};

#[cfg(test)]
mod tests;

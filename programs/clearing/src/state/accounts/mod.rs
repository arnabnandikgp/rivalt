//! Schema-5 scoped layouts and the explicitly qualified local release marker.
//! Venue identity, account risk, market backing and exceptional safety are distinct.
use crate::state::{
    records::{OrderBook, Position},
    OracleState,
};
use anchor_lang::prelude::*;

mod layouts;
mod resolution;
pub use layouts::*;
pub use resolution::*;

pub const SCHEMA_VERSION: u16 = 7;
pub const PROFILE_VERSION: u16 = 4;
pub use crate::state::identity::{MARKET_COUNT, MAX_MEMBERS};
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
    valid_identity, CROSS_MARKET_SENTINEL, MAX_PORTFOLIOS, MAX_SUBACCOUNT, MODE_CROSS,
    MODE_ISOLATED, ROLE_MAKER, ROLE_RECEIVER, ROLE_TRADER,
};

#[cfg(test)]
mod tests;

//! Schema 2 is a fresh test group, never an in-place reinterpretation of V1.
//! Fixed position slots authenticate the complete health universe. These layouts
//! alone grant no custody, trading, delegation or resolution authority.
use anchor_lang::prelude::*;

mod group;
mod margin;
mod market;
mod resolution;
pub use group::*;
pub use margin::*;
pub use market::*;
pub use resolution::*;

pub const SCHEMA_VERSION: u16 = 2;
pub const PROFILE_VERSION: u16 = 2;
pub const MARKET_COUNT: usize = 2;
pub const MAX_MEMBERS: usize = 64;
pub const MAX_PORTFOLIOS: u16 = 4;
pub const MAX_SUBACCOUNT: u16 = 8;
pub const CROSS_MARKET_SENTINEL: u8 = u8::MAX;

pub const MODE_CROSS: u8 = 0;
pub const MODE_ISOLATED: u8 = 1;
pub const ROLE_TRADER: u8 = 0;
pub const ROLE_MAKER: u8 = 1;
pub const ROLE_RECEIVER: u8 = 2;

/// This is a compile-time release gate, not an administrator-settable flag.
/// P20 may change it only with complete liquidation/default acceptance evidence.
pub const CROSS_TRADING_IMPLEMENTED: bool = false;
/// P18C owns complete isolated group recovery before this can be enabled.
pub const ISOLATED_TRADING_IMPLEMENTED: bool = false;

/// Validate immutable account identity separately from runtime health/authority.
pub fn valid_identity(
    portfolio_index: u16,
    subaccount_index: u16,
    mode: u8,
    isolated_market_index: u8,
    role: u8,
) -> bool {
    portfolio_index < MAX_PORTFOLIOS
        && subaccount_index <= MAX_SUBACCOUNT
        && role <= ROLE_RECEIVER
        && match mode {
            MODE_CROSS => {
                subaccount_index == 0
                    && isolated_market_index == CROSS_MARKET_SENTINEL
                    && role != ROLE_MAKER
            }
            MODE_ISOLATED => {
                subaccount_index > 0 && usize::from(isolated_market_index) < MARKET_COUNT
            }
            _ => false,
        }
}

#[cfg(test)]
mod tests;

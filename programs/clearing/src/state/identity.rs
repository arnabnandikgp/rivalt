//! Bounded immutable identities shared by current and compatibility decoders.
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

#[cfg(all(feature = "maker-liquidity-qualification", feature = "devnet-test-profile"))]
compile_error!("Local maker qualification cannot be combined with the devnet profile");

// Shared implementation compiled into two distinct first-party program deployments.
use anchor_lang::prelude::*;
use clearing::state::accounts::{MarginAccount, Market, Venue, MODE_ISOLATED, ROLE_MAKER};

#[cfg(not(feature = "devnet-test-profile"))]
const CLEARING_ID: Pubkey = pubkey!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo");
#[cfg(feature = "devnet-test-profile")]
const CLEARING_ID: Pubkey = pubkey!("BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv");

#[error_code]
pub enum MakerError {
    #[msg("Wrong maker config authority")]
    Authority,
    #[msg("Invalid maker binding")]
    Binding,
    #[msg("Epoch lifetime invalid or previous epoch still active")]
    Lifetime,
    #[msg("Quote outside bounded strategy, capacity or lifetime")]
    Quote,
}

include!("maker-canonical.rs");

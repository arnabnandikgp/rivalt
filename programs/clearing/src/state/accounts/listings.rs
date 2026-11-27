//! Inactive listings have a separate identity from an admitted trading Market.
use anchor_lang::prelude::*;

pub const LISTING_SCHEMA: u16 = 1;
pub const LISTING_INACTIVE: u8 = 0;

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct MarketListing {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub market_id: u16,
    pub symbol: [u8; 8],
    pub lots_per_unit: u64,
    pub quote_mint: Address,
    pub oracle_publisher: Address,
    pub oracle_feed: Address,
    pub status: u8,
    pub bump: u8,
}

// Reserving the symbol and the ID atomically prevents aliases without introducing
// a shared writable directory or growing the existing venue or margin roots.
#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct ListedSymbol {
    pub schema_version: u16,
    pub revision: u64,
    pub listing: Address,
    pub bump: u8,
}

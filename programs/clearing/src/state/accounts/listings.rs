//! Inactive listings have a separate identity from an admitted trading Market.
use anchor_lang::prelude::*;

pub const LISTING_SCHEMA: u16 = 1;
pub const LISTING_INACTIVE: u8 = 0;
/// Maker membership is immutable. The listing still has no permission to trade.
pub const LISTING_MAKERS_SEALED: u8 = 1;

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

/// Last qualified local index for an inactive listing. A zero deadline means
/// that no observation has qualified since the sources were bound.
#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct ListingIndex {
    pub schema_version: u16,
    pub revision: u64,
    pub listing: Address,
    pub sources: [Address; 4],
    pub source_sequences: [u64; 4],
    pub sampled_at: i64,
    pub deadline: i64,
    pub reference: u64,
    pub lower: u64,
    pub upper: u64,
    pub bump: u8,
}

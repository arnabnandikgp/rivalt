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

/// The market identity comes from the full listing PDA. These fields are the
/// inputs and outputs of the common causal funding transition.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Clone, Default)]
pub struct ListedFundingValues {
    pub observation_sequence: u64,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
    pub oracle: crate::state::OracleState,
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct ListedFunding {
    pub schema_version: u16,
    pub revision: u64,
    pub listing: Address,
    pub values: ListedFundingValues,
    pub bump: u8,
}

impl ListedFundingValues {
    pub(crate) fn market(&self, listing: &MarketListing) -> super::Market {
        super::Market {
            schema_version: super::SCHEMA_VERSION,
            venue: listing.venue,
            index: u8::MAX,
            symbol: listing.symbol,
            lots_per_unit: listing.lots_per_unit,
            terms_epoch: 1,
            config_epoch: 1,
            observation_sequence: self.observation_sequence,
            funding_index_scaled: self.funding_index_scaled,
            funding_time: self.funding_time,
            reference_price: self.reference_price,
            lower: self.lower,
            upper: self.upper,
            valid_from: self.valid_from,
            valid_until: self.valid_until,
            oracle: self.oracle,
            ..Default::default()
        }
    }
}

impl From<&super::Market> for ListedFundingValues {
    fn from(m: &super::Market) -> Self {
        Self {
            observation_sequence: m.observation_sequence,
            funding_index_scaled: m.funding_index_scaled,
            funding_time: m.funding_time,
            reference_price: m.reference_price,
            lower: m.lower,
            upper: m.upper,
            valid_from: m.valid_from,
            valid_until: m.valid_until,
            oracle: m.oracle,
        }
    }
}

/// Read-only membership at fill time. Market IDs remain full u16 values, even
/// when they are sparse. The per-market financial record has a separate PDA.
#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct ListedVenue {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub markets: [u16; 6],
    pub count: u8,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct ListedMarketBook {
    pub schema_version: u16,
    pub revision: u64,
    pub listing: Address,
    pub gross_lots: u64,
    pub collected_fees: u128,
    pub insurance: u64,
    pub fees: u64,
    pub settlement: u64,
    pub insurance_carry: u8,
    pub bump: u8,
}
pub const LISTED_VENUE_PROFILE: u16 = 7;
pub const LISTING_QUALIFICATION: u8 = 2;

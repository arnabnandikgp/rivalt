use super::*;

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct Resolution {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub epoch: u64,
    pub stage: u8,
    pub cursor: u64,
    pub count: u64,
    pub registry_hash: [u8; 32],
    pub membership_epoch: u64,
    pub live_index: Address,
    pub safety_epoch: u64,
    pub terms_epoch: u64,
    pub config_epochs: [u64; MARKET_COUNT],
    pub source_observations: [u64; MARKET_COUNT],
    pub source_deadlines: [i64; MARKET_COUNT],
    pub prices: [u64; MARKET_COUNT],
    pub funding: [i128; MARKET_COUNT],
    pub frozen_at: i64,
    pub cash_before: u64,
    pub pools_before: [u64; MARKET_COUNT],
    pub insurance_before: [u64; MARKET_COUNT],
    pub fees_before: [u64; MARKET_COUNT],
    pub allocated_before: u64,
    pub scanned_cash: u64,
    pub scanned_lots: [i128; MARKET_COUNT],
    pub scanned_gross: [u64; MARKET_COUNT],
    pub claim_sums: [i128; MARKET_COUNT],
    pub positive_scaled: [u128; MARKET_COUNT],
    pub budgets: [u64; MARKET_COUNT],
    pub insurance_spent: [u64; MARKET_COUNT],
    pub cash_applied: u64,
    pub remaining_lots: [i128; MARKET_COUNT],
    pub remaining_gross: [u64; MARKET_COUNT],
    pub remaining_claims: [i128; MARKET_COUNT],
    pub bump: u8,
}


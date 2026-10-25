use super::*;
use crate::state::OracleState;

#[account]
#[derive(InitSpace, Default)]
pub struct GroupMarketV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub index: u8,
    pub symbol: [u8; 8],
    pub lots_per_unit: u64,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub gross_lots: u64,
    pub observation_sequence: u64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
    pub oracle: OracleState,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct MakerRegistrationV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub market: Pubkey,
    pub market_index: u8,
    pub maker_id: u8,
    pub capital: Pubkey,
    pub owner: Pubkey,
    pub pricing_program: Pubkey,
    pub program_data: Pubkey,
    pub config: Pubkey,
    pub approved_hash: [u8; 32],
    pub authority_epoch: u64,
    pub quote_epoch: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub inventory_limit: u64,
    pub buy_consumed: u64,
    pub sell_consumed: u64,
    pub quarantined: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct CapitalBindingV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub capital: Pubkey,
    pub registration: Pubkey,
}

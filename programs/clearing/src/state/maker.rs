//! Persistent maker state and its serialized supporting types.
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct MakerRegistration {
    pub version: u16,
    pub maker_id: u8,
    pub market: Pubkey,
    pub capital: Pubkey,
    pub owner: Pubkey,
    pub pricing_program: Pubkey,
    pub program_data: Pubkey,
    pub config: Pubkey,
    /// Entire loader ProgramData, including deployment slot, authority and code.
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
#[derive(InitSpace)]
pub struct CapitalBinding {
    pub market: Pubkey,
    pub capital: Pubkey,
    pub registration: Pubkey,
}

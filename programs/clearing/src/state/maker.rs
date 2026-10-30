//! Persistent maker state and its serialized supporting types.
use anchor_lang::prelude::*;

#[account(discriminator = [231, 196, 106, 151, 199, 213, 13, 66])]
#[derive(InitSpace)]
pub struct LegacyMakerRegistration {
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

#[account(discriminator = [176, 183, 79, 146, 172, 158, 6, 18])]
#[derive(InitSpace)]
pub struct LegacyCapitalBinding {
    pub market: Pubkey,
    pub capital: Pubkey,
    pub registration: Pubkey,
}

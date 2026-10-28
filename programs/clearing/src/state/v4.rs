//! Profile-4 maker identity/consumption. Financial account schemas stay version 3.
use anchor_lang::prelude::*;

pub const VERSION: u16 = 4;
pub const MAKER_COUNT: usize = 3;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct SampleInputV4 {
    pub registration: Pubkey,
    pub capital: Pubkey,
    pub authority_epoch: u64,
    pub control_epoch: u64,
    pub shape_epoch: u64,
    pub depth_epoch: u64,
    pub price_sequence: u64,
    pub buy_consumed: u64,
    pub sell_consumed: u64,
    pub expiry_slot: u64,
    pub expiry_time: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct SampleLegV4 {
    pub instance: u8,
    pub lots: u64,
    pub gross: u64,
}

#[account]
#[derive(InitSpace)]
pub struct LiquidityRegistryV4 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub count: u8,
    pub sealed: bool,
    pub registrations: [Pubkey; MAKER_COUNT],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MakerRegistrationV4 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub capital: Pubkey,
    pub owner: Pubkey,
    pub pricing_program: Pubkey,
    pub program_data: Pubkey,
    pub config: Pubkey,
    pub price: Pubkey,
    pub approved_hash: [u8; 32],
    pub instance: u8,
    pub authority_epoch: u64,
    pub depth_epoch: u64,
    pub buy_consumed: u64,
    pub sell_consumed: u64,
    pub quarantined: bool,
    pub bump: u8,
}

/// Event payload: identical field bytes without an account discriminator.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityRegistryPayloadV4 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub count: u8,
    pub sealed: bool,
    pub registrations: [Pubkey; MAKER_COUNT],
    pub bump: u8,
}

impl From<&LiquidityRegistryV4> for LiquidityRegistryPayloadV4 {
    fn from(account: &LiquidityRegistryV4) -> Self {
        Self {
            schema_version: account.schema_version,
            venue: account.venue,
            market: account.market,
            count: account.count,
            sealed: account.sealed,
            registrations: account.registrations,
            bump: account.bump,
        }
    }
}

/// Event payload: identical field bytes without an account discriminator.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MakerRegistrationPayloadV4 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub capital: Pubkey,
    pub owner: Pubkey,
    pub pricing_program: Pubkey,
    pub program_data: Pubkey,
    pub config: Pubkey,
    pub price: Pubkey,
    pub approved_hash: [u8; 32],
    pub instance: u8,
    pub authority_epoch: u64,
    pub depth_epoch: u64,
    pub buy_consumed: u64,
    pub sell_consumed: u64,
    pub quarantined: bool,
    pub bump: u8,
}

impl From<&MakerRegistrationV4> for MakerRegistrationPayloadV4 {
    fn from(account: &MakerRegistrationV4) -> Self {
        Self {
            schema_version: account.schema_version,
            venue: account.venue,
            market: account.market,
            capital: account.capital,
            owner: account.owner,
            pricing_program: account.pricing_program,
            program_data: account.program_data,
            config: account.config,
            price: account.price,
            approved_hash: account.approved_hash,
            instance: account.instance,
            authority_epoch: account.authority_epoch,
            depth_epoch: account.depth_epoch,
            buy_consumed: account.buy_consumed,
            sell_consumed: account.sell_consumed,
            quarantined: account.quarantined,
            bump: account.bump,
        }
    }
}

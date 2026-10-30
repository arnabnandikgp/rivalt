//! Profile-4 maker identity/consumption. Financial account schemas stay version 3.
use anchor_lang::prelude::*;

pub const VERSION: u16 = 4;
pub const MAKER_COUNT: usize = 3;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ExecutedLeg {
    pub registration: Pubkey,
    pub capital: Pubkey,
    pub instance: u8,
    pub lots: u64,
    pub gross: u64,
    pub price_sequence: u64,
    pub authority_epoch: u64,
    pub control_epoch: u64,
    pub shape_epoch: u64,
    pub depth_epoch: u64,
    pub consumed_before: u64,
    pub consumed_after: u64,
}

#[account(discriminator = [44, 251, 162, 245, 60, 52, 128, 8])]
#[derive(InitSpace)]
pub struct FundingPublisher {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub publisher: Pubkey,
    pub authority_epoch: u64,
    pub last_sequence: u64,
    pub last_observed_slot: u64,
    pub last_observed_time: i64,
    pub enabled: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct FundingReport {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub authority_epoch: u64,
    pub sequence: u64,
    pub expected_observation_sequence: u64,
    pub expected_config_epoch: u64,
    pub expected_terms_epoch: u64,
    pub observed_slot: u64,
    pub observed_time: i64,
    pub valid_until_slot: u64,
    pub valid_until_time: i64,
    pub reference_price: u64,
    pub quantity: u64,
    pub bid: u64,
    pub ask: u64,
    pub outcome: u8,
    pub input_digest: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct FundingPublisherPayload {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub publisher: Pubkey,
    pub authority_epoch: u64,
    pub last_sequence: u64,
    pub last_observed_slot: u64,
    pub last_observed_time: i64,
    pub enabled: bool,
    pub bump: u8,
}

impl From<&FundingPublisher> for FundingPublisherPayload {
    fn from(value: &FundingPublisher) -> Self {
        Self {
            schema_version: value.schema_version,
            venue: value.venue,
            market: value.market,
            publisher: value.publisher,
            authority_epoch: value.authority_epoch,
            last_sequence: value.last_sequence,
            last_observed_slot: value.last_observed_slot,
            last_observed_time: value.last_observed_time,
            enabled: value.enabled,
            bump: value.bump,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct SampleInput {
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
pub struct SampleLeg {
    pub instance: u8,
    pub lots: u64,
    pub gross: u64,
}

#[account(discriminator = [133, 250, 116, 223, 223, 193, 72, 233])]
#[derive(InitSpace)]
pub struct LiquidityRegistry {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub count: u8,
    pub sealed: bool,
    pub registrations: [Pubkey; MAKER_COUNT],
    pub bump: u8,
}

#[account(discriminator = [64, 36, 102, 180, 245, 54, 123, 199])]
#[derive(InitSpace)]
pub struct MakerRegistration {
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
pub struct LiquidityRegistryPayload {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub count: u8,
    pub sealed: bool,
    pub registrations: [Pubkey; MAKER_COUNT],
    pub bump: u8,
}

impl From<&LiquidityRegistry> for LiquidityRegistryPayload {
    fn from(account: &LiquidityRegistry) -> Self {
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
pub struct MakerRegistrationPayload {
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

impl From<&MakerRegistration> for MakerRegistrationPayload {
    fn from(account: &MakerRegistration) -> Self {
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

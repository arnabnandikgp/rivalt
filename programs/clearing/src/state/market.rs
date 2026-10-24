//! Persistent market state and its serialized supporting types.
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub schema_version: u16,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub authority: Pubkey,
    pub quote_mint: Pubkey,
    pub vault: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub paused: bool,
    /// 0 CustodyOnly, 1 synthetic TestRoutes, 2 oracle profile, 3 frozen resolution.
    pub mode: u8,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    /// Allocated token assets. Actual vault may have separately observable surplus.
    pub allocated_vault: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

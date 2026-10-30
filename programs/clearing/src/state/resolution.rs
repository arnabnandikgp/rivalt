//! Persistent resolution state and its serialized supporting types.
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct ResolutionHeader {
    pub epoch: u64,
    pub stage: u8,
    pub cursor: u16,
    pub count: u16,
    pub registry_hash: [u8; 32],
    pub price: u64,
    pub funding: i128,
    pub frozen_at: i64,
    pub initial_cash: u64,
    pub initial_pool: u64,
    pub initial_insurance: u64,
    pub initial_fees: u64,
    pub initial_vault: u64,
    pub scanned_cash: u64,
    pub scanned_lots: i128,
    pub scanned_gross: u64,
    pub claim_sum: i128,
    pub remaining_lots: i128,
    pub remaining_gross: u64,
    pub debt: u128,
    pub positive: u128,
    pub insured_atoms: u64,
    pub plan_pool: u64,
    pub assigned: u128,
    pub extra: u16,
    pub rounding_sum: i128,
    pub collected_total: u64,
    pub paid_applied: u64,
    pub insurance_moved: bool,
    pub recovery_since: i64,
    pub recovery_last: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct LegacyResolutionRow {
    pub cash_before: u64,
    pub lots: i64,
    pub generation: u64,
    /// Valued claim plus collected*SCALE. Ordinary v remains frozen until Apply.
    pub claim: i128,
    pub collected: u64,
    pub insured_scaled: u128,
    pub impaired_scaled: u128,
    pub paid: u64,
    pub rounding_scaled: i128,
    pub remainder: u128,
}

#[account]
#[derive(InitSpace)]
pub struct ResolutionState {
    pub version: u16,
    pub market: Pubkey,
    pub header: ResolutionHeader,
    #[max_len(64)]
    pub rows: Vec<LegacyResolutionRow>,
    pub bump: u8,
}

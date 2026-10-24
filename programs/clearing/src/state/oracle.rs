//! Persistent oracle state and its serialized supporting types.
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct OracleState {
    pub sources: [Pubkey; 4],
    pub source_sequences: [u64; 4],
    pub sampled_at: i64,
    pub source_deadline: i64,
    /// 0 no credible bounds, 1 degraded, 2 normal (subject to live clock checks).
    pub status: u8,
    pub outcome: u8,
    pub valid_since: i64,
    pub last_qualified: i64,
    pub held_until: i64,
    pub held_slot: u64,
    pub held_epoch: u64,
    pub funding_base: i128,
    pub premium_scaled: i128,
    pub quantity: u64,
    pub bid: u64,
    pub ask: u64,
    pub covered_seconds: u64,
    pub skipped_seconds: u64,
}

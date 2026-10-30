//! Persistent participant state and its serialized supporting types.
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Participant {
    pub schema_version: u16,
    pub market: Pubkey,
    pub owner: Pubkey,
    pub id: u16,
    pub cash: u64,
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
    pub nonce: u64,
    pub reserved: u64,
    /// Zero means inactive; IDs never repeat when a bounded slot is reused.
    pub order_ids: [u64; 4],
    pub book: crate::state::LegacyOrderBook,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ParticipantRegistry {
    pub schema_version: u16,
    pub market: Pubkey,
    pub count: u16,
    #[max_len(64)]
    pub members: Vec<Pubkey>,
    pub bump: u8,
}

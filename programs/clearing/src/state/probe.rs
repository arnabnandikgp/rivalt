//! Persistent probe state and its serialized supporting types.
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ProbeRecord {
    pub owner: Pubkey,
    pub nonce: u64,
    pub signed_value: i128,
    pub optional_value: Option<u64>,
    pub choice: ProbeChoice,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum ProbeChoice {
    Empty,
    Number { value: u64 },
}

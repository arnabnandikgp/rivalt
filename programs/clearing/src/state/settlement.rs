//! Persistent settlement state and its serialized supporting types.
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ExitGuard {
    pub market: Pubkey,
    pub sequence: u64,
    pub observation: u64,
    pub count: u16,
    pub next: u16,
    pub cash: u64,
    pub lots: i128,
    pub exposed: u64,
    pub unpaid: i128,
    pub bump: u8,
}

//! Persistent route state and its serialized supporting types.
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct TestRouteState {
    pub market: Pubkey,
    pub observation_sequence: u64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
    pub gross_lots: u64,
    pub bump: u8,
    pub oracle: crate::state::OracleState,
}

//! Persistent order state and its serialized supporting types.
use crate::constants::orders::{OPEN, PARTIAL};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct StoredOrder {
    pub id: u64,
    pub version: u64,
    pub state: u8,
    pub side: u8,
    pub original_lots: u64,
    pub lots: u64,
    pub filled: u64,
    pub notional: u64,
    pub fee_charged: u64,
    pub fee_budget: u64,
    pub limit: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    /// 0 none, 1 central reference >= threshold, 2 <= threshold.
    pub trigger: u8,
    pub threshold: u64,
    pub reduce_only: bool,
    pub generation: u64,
    pub group_id: u64,
    pub terms_epoch: u64,
    pub reserve: u64,
}

impl StoredOrder {
    pub fn active(&self) -> bool {
        self.state == OPEN || self.state == PARTIAL
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct ProtectiveGroup {
    pub id: u64,
    pub version: u64,
    pub original: u64,
    pub remaining: u64,
    pub generation: u64,
    pub side: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct OrderBook {
    pub last_order_id: u64,
    pub last_group_id: u64,
    pub reserve_observation: u64,
    pub orders: [StoredOrder; 4],
    pub groups: [ProtectiveGroup; 2],
}

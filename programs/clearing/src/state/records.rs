//! Shared serialized position/order records, independent of deployment generation.
use super::identity::{MARKET_COUNT};
use super::{OrderRecord, ProtectiveGroup};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct Position {
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct StoredOrder {
    pub market_index: u8,
    /// Zero for owner-created authority, otherwise the root's delegate epoch.
    pub delegate_epoch: u64,
    pub order: OrderRecord,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct Protection {
    pub market_index: u8,
    pub protection: ProtectiveGroup,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct OrderBook {
    pub last_order_id: u64,
    pub last_group_id: u64,
    pub reserve_observations: [u64; MARKET_COUNT],
    pub orders: [StoredOrder; 4],
    pub protections: [Protection; 2],
}

/// Fixed-size successor header: there is no attacker-controlled Vec prefix or
/// population-sized allocation in the account decoder.
pub type RegistryAccount = BorshAccount<super::accounts::VenueRegistry>;

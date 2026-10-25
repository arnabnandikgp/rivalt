use super::*;
use crate::state::{ProtectiveGroup, StoredOrder};

#[account]
#[derive(InitSpace, Default)]
pub struct PortfolioV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub owner: Pubkey,
    pub index: u16,
    /// Nine immutable child identities; there is no account deletion/reuse.
    pub children: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct PositionV2 {
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct StoredOrderV2 {
    pub market_index: u8,
    /// Zero for owner-created authority, otherwise the root's delegate epoch.
    pub delegate_epoch: u64,
    pub order: StoredOrder,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct ProtectionV2 {
    pub market_index: u8,
    pub protection: ProtectiveGroup,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct OrderBookV2 {
    pub last_order_id: u64,
    pub last_group_id: u64,
    pub reserve_observations: [u64; MARKET_COUNT],
    pub orders: [StoredOrderV2; 4],
    pub protections: [ProtectionV2; 2],
}

#[account]
#[derive(InitSpace, Default)]
pub struct MarginAccountV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub portfolio: Pubkey,
    pub owner: Pubkey,
    pub subaccount_index: u16,
    pub id: u16,
    pub mode: u8,
    pub isolated_market_index: u8,
    pub role: u8,
    pub cash: u64,
    /// Index equals the immutable group's market index, even for empty entries.
    pub positions: [PositionV2; MARKET_COUNT],
    pub nonce: u64,
    pub state_version: u64,
    pub delegate: Pubkey,
    pub delegate_expiry_slot: u64,
    pub delegate_epoch: u64,
    /// Diagnostic cache only; admission recomputes the complete order book.
    pub reserved: u64,
    pub book: OrderBookV2,
    pub bump: u8,
}

use super::*;

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
    pub positions: [Position; MARKET_COUNT],
    pub nonce: u64,
    pub state_version: u64,
    pub delegate: Pubkey,
    pub delegate_expiry_slot: u64,
    pub delegate_epoch: u64,
    /// Diagnostic cache only; admission recomputes the complete order book.
    pub reserved: u64,
    pub book: OrderBook,
    pub bump: u8,
}

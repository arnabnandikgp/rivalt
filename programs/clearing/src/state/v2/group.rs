use super::*;

#[account]
#[derive(InitSpace, Default)]
pub struct ClearingGroupV2 {
    pub schema_version: u16,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub authority: Pubkey,
    pub quote_mint: Pubkey,
    pub vault: Pubkey,
    /// Canonical index 0 BTC, 1 ETH; immutable after both registrations.
    pub markets: [Pubkey; MARKET_COUNT],
    pub market_count: u8,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    /// 0 custody, 1 isolated trading, 2 cross trading, 3 frozen resolution.
    pub mode: u8,
    pub paused: bool,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub allocated_vault: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct GroupRegistryV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub count: u16,
    #[max_len(64)]
    #[borsh(deserialize_with = "deserialize_cohort")]
    pub members: Vec<Pubkey>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct GroupExitGuardV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub sequence: u64,
    pub observations: [u64; MARKET_COUNT],
    pub funding_bounds: [[i128; 2]; MARKET_COUNT],
    pub source_deadlines: [i64; MARKET_COUNT],
    pub count: u16,
    pub next: u16,
    pub cash: u64,
    pub lots: [i128; MARKET_COUNT],
    pub gross_lots: [u64; MARKET_COUNT],
    pub unpaid_scaled: i128,
    pub bump: u8,
}

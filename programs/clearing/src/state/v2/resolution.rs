use super::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct GroupResolutionHeaderV2 {
    pub epoch: u64,
    pub stage: u8,
    pub cursor: u16,
    pub count: u16,
    pub registry_hash: [u8; 32],
    pub prices: [u64; MARKET_COUNT],
    pub funding: [i128; MARKET_COUNT],
    pub frozen_at: i64,
    pub initial_cash: u64,
    pub initial_pool: u64,
    pub initial_insurance: u64,
    pub initial_fees: u64,
    pub initial_vault: u64,
    pub scanned_cash: u64,
    pub scanned_lots: [i128; MARKET_COUNT],
    pub scanned_gross: [u64; MARKET_COUNT],
    pub claim_sum: i128,
    pub remaining_lots: [i128; MARKET_COUNT],
    pub remaining_gross: [u64; MARKET_COUNT],
    pub debt: u128,
    pub positive: u128,
    pub insured_atoms: u64,
    pub plan_pool: u64,
    pub assigned: u128,
    pub extra: u16,
    pub rounding_sum: i128,
    pub collected_total: u64,
    pub paid_applied: u64,
    pub insurance_moved: bool,
    pub recovery_since: i64,
    pub recovery_last: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct GroupResolutionRowV2 {
    pub cash_before: u64,
    pub lots: [i64; MARKET_COUNT],
    pub generations: [u64; MARKET_COUNT],
    /// Both fully valued claims net once, inside this margin account only.
    pub claim_scaled: i128,
    pub collected: u64,
    pub insured_scaled: u128,
    pub impaired_scaled: u128,
    pub paid: u64,
    pub rounding_scaled: i128,
    pub remainder: u128,
}

#[account]
#[derive(InitSpace, Default)]
pub struct GroupResolutionV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub header: GroupResolutionHeaderV2,
    #[max_len(64)]
    #[borsh(deserialize_with = "deserialize_cohort")]
    pub rows: Vec<GroupResolutionRowV2>,
    pub bump: u8,
}

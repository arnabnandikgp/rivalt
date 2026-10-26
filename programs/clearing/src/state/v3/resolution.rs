use super::*;

/// Unsigned little-endian fixed width. Zero has exactly the all-zero encoding.
/// Work arithmetic is checked; no integer truncation or floating point.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct WideV3 {
    pub limbs: [u64; WIDE_LIMBS],
}
impl Default for WideV3 {
    fn default() -> Self {
        Self {
            limbs: [0; WIDE_LIMBS],
        }
    }
}

/// Fixed scalar inputs are enough to reconstruct every terminal exact adjustment.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace)]
pub struct ResolutionRowV3 {
    pub member: Pubkey,
    pub cash_before: u64,
    pub lots: [i64; MARKET_COUNT],
    pub generations: [u64; MARKET_COUNT],
    pub claims_scaled: [i128; MARKET_COUNT],
    pub collected: u64,
    /// Magnitudes. Direction is determined by the original claim sign.
    pub exact_flow_numerators: [WideV3; MARKET_COUNT],
    pub rounded_flows: [u64; MARKET_COUNT],
    pub cash_after: u64,
    pub applied: bool,
}

#[account]
#[derive(InitSpace, Default)]
pub struct ResolutionPageV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub epoch: u64,
    pub page_index: u16,
    pub row_count: u8,
    pub rows: [ResolutionRowV3; RESOLUTION_PAGE_ROWS],
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct ResolutionV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub epoch: u64,
    pub stage: u8,
    pub cursor: u16,
    pub count: u16,
    pub registry_hash: [u8; 32],
    pub safety_epoch: u64,
    pub terms_epoch: u64,
    pub config_epochs: [u64; MARKET_COUNT],
    pub source_observations: [u64; MARKET_COUNT],
    pub source_deadlines: [i64; MARKET_COUNT],
    pub proposal_hash: [u8; 32],
    pub proposal_uploaded: u16,
    pub prices: [u64; MARKET_COUNT],
    pub funding: [i128; MARKET_COUNT],
    pub frozen_at: i64,
    pub cash_before: u64,
    pub pools_before: [u64; MARKET_COUNT],
    pub insurance_before: [u64; MARKET_COUNT],
    pub fees_before: [u64; MARKET_COUNT],
    pub allocated_before: u64,
    pub scanned_cash: u64,
    pub scanned_lots: [i128; MARKET_COUNT],
    pub scanned_gross: [u64; MARKET_COUNT],
    pub claim_sums: [i128; MARKET_COUNT],
    pub positive_scaled: [u128; MARKET_COUNT],
    pub budgets: [u64; MARKET_COUNT],
    pub insurance_spent: [u64; MARKET_COUNT],
    pub evaluation: u8,
    pub clipped_mask: u8,
    pub common: WideV3,
    pub rate_numerators: [WideV3; MARKET_COUNT],
    /// At most 186 bits; unused high six bits must be zero.
    pub rate_factor: [u64; 3],
    pub flow_denominator: WideV3,
    pub cash_applied: u64,
    pub remaining_lots: [i128; MARKET_COUNT],
    pub remaining_gross: [u64; MARKET_COUNT],
    pub remaining_claims: [i128; MARKET_COUNT],
    pub bump: u8,
}

/// Bounded continuation registers for arithmetic, proof scans and circulation.
/// P26 verifies every opcode/cursor; caller data is not a trusted payout plan.
#[account]
#[derive(InitSpace)]
pub struct ResolutionWorkV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub epoch: u64,
    pub opcode: u8,
    pub row: u16,
    pub limb_cursor: u16,
    pub registers: [WideV3; 8],
    /// Original <=192 edges plus <=67 residual source/sink edges, both directions.
    pub residual_capacity: [u16; 518],
    /// Market forward-edge ordering is checked as a complete stable permutation.
    pub market_edge_order: [[u16; MAX_MEMBERS]; MARKET_COUNT],
    pub visited_members: u64,
    pub parents: [u16; 69],
    pub dfs_next: [u16; 69],
    pub dfs_path: [u16; 69],
    pub depth: u16,
    pub augmentations: u16,
    pub bump: u8,
}
impl Default for ResolutionWorkV3 {
    fn default() -> Self {
        Self {
            schema_version: 0,
            venue: Pubkey::default(),
            epoch: 0,
            opcode: 0,
            row: 0,
            limb_cursor: 0,
            registers: core::array::from_fn(|_| WideV3::default()),
            residual_capacity: [0; 518],
            market_edge_order: [[0; MAX_MEMBERS]; MARKET_COUNT],
            visited_members: 0,
            parents: [0; 69],
            dfs_next: [0; 69],
            dfs_path: [0; 69],
            depth: 0,
            augmentations: 0,
            bump: 0,
        }
    }
}

use super::*;

#[account]
#[derive(InitSpace, Default)]
pub struct VenueV3 {
    pub schema_version: u16,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub authority: Pubkey,
    pub fee_authority: Pubkey,
    pub reserve_authority: Pubkey,
    pub reserve_destination_owner: Pubkey,
    pub quote_mint: Pubkey,
    pub vault: Pubkey,
    pub markets: [Pubkey; MARKET_COUNT],
    pub market_count: u8,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub insurance_fee_share_bps: u16,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct CustodyV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub total_cash: u64,
    pub allocated_vault: u64,
    /// Event discovery order only; never an ordinary signed-intent prerequisite.
    pub sequence: u64,
    /// Only market-dependent economic mutations invalidate gain certificates.
    pub liability_versions: [u64; MARKET_COUNT],
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct SafetyV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub mode: u8,
    pub paused: bool,
    pub epoch: u64,
    pub resolution_epoch: u64,
    pub recovery_since: i64,
    pub recovery_last: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct VenueRegistryV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub membership_version: u64,
    pub count: u16,
    #[max_len(64)]
    #[borsh(deserialize_with = "crate::state::v2::deserialize_cohort")]
    pub members: Vec<Pubkey>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct PortfolioV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub owner: Pubkey,
    pub index: u16,
    pub children: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct MarginAccountV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub portfolio: Pubkey,
    pub owner: Pubkey,
    pub subaccount_index: u16,
    pub id: u16,
    pub mode: u8,
    pub isolated_market_index: u8,
    pub role: u8,
    pub cash: u64,
    /// Canonical venue-registry indices, not a user-selected group membership.
    pub positions: [PositionV2; MARKET_COUNT],
    pub nonce: u64,
    pub state_version: u64,
    pub delegate: Pubkey,
    pub delegate_expiry_slot: u64,
    pub delegate_epoch: u64,
    pub reserved: u64,
    /// Reuse only the stable scalar wire records; V2 handlers cannot own V3 bytes.
    pub book: OrderBookV2,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct MarketV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub index: u8,
    pub symbol: [u8; 8],
    pub lots_per_unit: u64,
    pub cross_eligible: bool,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub gross_lots: u64,
    pub observation_sequence: u64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
    pub oracle: OracleState,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct MarketLedgerV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub market_index: u8,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    /// Modulo-four fee-count carry, never collateral or a participant claim.
    pub insurance_fee_remainder: u8,
    pub version: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct MakerRegistrationV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub market_index: u8,
    pub maker_id: u8,
    pub capital: Pubkey,
    pub owner: Pubkey,
    pub pricing_program: Pubkey,
    pub program_data: Pubkey,
    pub config: Pubkey,
    pub approved_hash: [u8; 32],
    pub authority_epoch: u64,
    pub quote_epoch: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub inventory_limit: u64,
    pub buy_consumed: u64,
    pub sell_consumed: u64,
    pub quarantined: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct CapitalBindingV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub capital: Pubkey,
    pub registration: Pubkey,
}

#[account]
#[derive(InitSpace, Default)]
pub struct SettlementCertificateV3 {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market_index: u8,
    pub safety_epoch: u64,
    pub membership_version: u64,
    pub liability_versions: [u64; MARKET_COUNT],
    pub observations: [u64; MARKET_COUNT],
    pub funding_bounds: [[i128; 2]; MARKET_COUNT],
    pub source_deadlines: [i64; MARKET_COUNT],
    pub required_market_mask: u8,
    pub count: u16,
    pub next: u16,
    pub cash: u64,
    pub lots: [i128; MARKET_COUNT],
    pub claim_sum: i128,
    pub complete: bool,
    pub bump: u8,
}

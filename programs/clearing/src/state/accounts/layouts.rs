use super::*;

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct Venue {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub authority: Address,
    pub fee_authority: Address,
    pub reserve_authority: Address,
    pub reserve_destination_owner: Address,
    pub quote_mint: Address,
    pub vault: Address,
    pub markets: [Address; MARKET_COUNT],
    pub market_count: u8,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub insurance_fee_share_bps: u16,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct Custody {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub allocated_vault: u64,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct VenueSafety {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub mode: u8,
    pub paused: bool,
    pub epoch: u64,
    pub resolution_epoch: u64,
    pub recovery_since: i64,
    pub recovery_last: i64,
    pub bump: u8,
}

/// Terminal administrative proof only. Ordinary owner exits never depend on
/// this complete-cohort scan or its global discovery-sequence stamp.
#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct RetirementCertificate {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub safety_epoch: u64,
    pub membership_version: u64,
    pub cash: u64,
    pub count: u64,
    pub next: u64,
    pub complete: bool,
    pub membership: MembershipState,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct VenueRegistry {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    /// Changes only when Financial membership changes, never empty registration.
    pub membership_epoch: u64,
    pub next_id: u64,
    pub registered_count: u64,
    pub financial_count: u64,
    pub live_index: Address,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct Portfolio {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub owner: Address,
    pub index: u32,
    pub active_children: u32,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct MarginAccount {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub portfolio: Address,
    pub owner: Address,
    pub subaccount_index: u32,
    pub id: u64,
    pub mode: u8,
    pub isolated_market_index: u8,
    pub role: u8,
    pub cash: u64,
    /// Canonical venue-registry indices, not a user-selected group membership.
    pub positions: [Position; MARKET_COUNT],
    pub nonce: u64,
    pub state_version: u64,
    pub delegate: Address,
    pub delegate_expiry_slot: u64,
    pub delegate_epoch: u64,
    pub reserved: u64,
    /// Reuse only the stable scalar wire records; V2 handlers cannot own V3 bytes.
    pub book: OrderBook,
    pub lifecycle: u8,
    pub activation_generation: u64,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct Market {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
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

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct MarketLedger {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub market: Address,
    pub market_index: u8,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    /// Modulo-four fee-count carry, never collateral or a participant claim.
    pub insurance_fee_remainder: u8,
    pub version: u64,
    /// Economic mutations of roots owing to this market invalidate its backing proof.
    pub liability_version: u64,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct CapitalBinding {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub capital: Address,
    pub registration: Address,
}

#[account(borsh)]
#[derive(InitSpace, Default, Clone)]
pub struct SettlementCertificate {
    pub schema_version: u16,
    /// Scoped journal revision; never a financial signing or risk parameter.
    pub revision: u64,
    pub venue: Address,
    pub market_index: u8,
    pub safety_epoch: u64,
    pub membership_version: u64,
    pub liability_version: u64,
    pub observations: [u64; MARKET_COUNT],
    pub funding_bounds: [[i128; 2]; MARKET_COUNT],
    pub source_deadlines: [i64; MARKET_COUNT],
    pub required_market_mask: u8,
    pub count: u64,
    pub next: u64,
    pub cash: u64,
    pub lots: [i128; MARKET_COUNT],
    pub claim_sum: i128,
    pub complete: bool,
    pub membership: MembershipState,
    pub bump: u8,
}

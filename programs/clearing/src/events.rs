//! Critical current event schemas; historical journal tags stay versioned.
use crate::state::*;
use anchor_lang::prelude::*;

#[event(discriminator = [211, 73, 106, 79, 120, 190, 40, 231])]
pub struct LiquidityRegistryChanged {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub registry: Pubkey,
    pub state: crate::state::liquidity::LiquidityRegistryPayload,
}

#[event(discriminator = [88, 64, 64, 174, 240, 198, 130, 26])]
pub struct LiquidityMakerChanged {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: MarketSnapshot,
    pub registration: Pubkey,
    pub state: crate::state::liquidity::MakerRegistrationPayload,
    pub operation: u8,
}

/// Version-3 custody payloads are scalar snapshots, never nested account types.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AccountCashSnapshot {
    pub margin: Pubkey,
    pub portfolio: Pubkey,
    pub owner: Pubkey,
    pub subaccount_index: u16,
    pub id: u16,
    pub mode: u8,
    pub isolated_market_index: u8,
    pub role: u8,
    pub cash: u64,
    pub state_version: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarketLedgerSnapshot {
    pub ledger: Pubkey,
    pub market: Pubkey,
    pub market_index: u8,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub insurance_fee_remainder: u8,
    pub version: u64,
}

#[event(discriminator = [116, 78, 173, 90, 240, 10, 196, 1])]
pub struct AccountCustodyChanged {
    pub schema_version: u16,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    /// 0 venue, 1 market, 2 portfolio, 3 margin, 4 deposit, 5 withdrawal,
    /// 6 cash transfer, 7 pause, 8 surplus classification, 9 reserve seed, 10 registry.
    pub kind: u8,
    pub actor: Pubkey,
    pub subject: Pubkey,
    pub index: u16,
    pub amount: u64,
    pub members: Vec<AccountCashSnapshot>,
    pub ledgers: Vec<MarketLedgerSnapshot>,
    pub authority: Pubkey,
    pub fee_authority: Pubkey,
    pub reserve_authority: Pubkey,
    pub reserve_destination_owner: Pubkey,
    pub quote_mint: Pubkey,
    pub vault: Pubkey,
    pub markets: [Pubkey; 2],
    pub market_count: u8,
    pub insurance_fee_share_bps: u16,
    pub mode: u8,
    pub paused: bool,
    pub safety_epoch: u64,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub total_cash: u64,
    pub allocated_vault: u64,
    pub liability_versions: [u64; 2],
    pub membership_version: Option<u64>,
    pub member_count: Option<u16>,
    pub actual_vault: Option<u64>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarginAccountSnapshot {
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
    pub positions: [crate::state::Position; 2],
    pub nonce: u64,
    pub state_version: u64,
    pub delegate: Pubkey,
    pub delegate_expiry_slot: u64,
    pub delegate_epoch: u64,
    pub reserved: u64,
    pub book: crate::state::OrderBook,
    pub bump: u8,
}

impl From<&crate::state::accounts::MarginAccount> for MarginAccountSnapshot {
    fn from(state: &crate::state::accounts::MarginAccount) -> Self {
        Self {
            schema_version: state.schema_version,
            venue: state.venue,
            portfolio: state.portfolio,
            owner: state.owner,
            subaccount_index: state.subaccount_index,
            id: state.id,
            mode: state.mode,
            isolated_market_index: state.isolated_market_index,
            role: state.role,
            cash: state.cash,
            positions: state.positions,
            nonce: state.nonce,
            state_version: state.state_version,
            delegate: state.delegate,
            delegate_expiry_slot: state.delegate_expiry_slot,
            delegate_epoch: state.delegate_epoch,
            reserved: state.reserved,
            book: state.book,
            bump: state.bump,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarketSnapshot {
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
    pub oracle: crate::state::OracleState,
    pub bump: u8,
}

impl From<&crate::state::accounts::Market> for MarketSnapshot {
    fn from(state: &crate::state::accounts::Market) -> Self {
        Self {
            schema_version: state.schema_version,
            venue: state.venue,
            index: state.index,
            symbol: state.symbol,
            lots_per_unit: state.lots_per_unit,
            cross_eligible: state.cross_eligible,
            terms_epoch: state.terms_epoch,
            config_epoch: state.config_epoch,
            funding_index_scaled: state.funding_index_scaled,
            funding_time: state.funding_time,
            gross_lots: state.gross_lots,
            observation_sequence: state.observation_sequence,
            reference_price: state.reference_price,
            lower: state.lower,
            upper: state.upper,
            valid_from: state.valid_from,
            valid_until: state.valid_until,
            oracle: state.oracle,
            bump: state.bump,
        }
    }
}

#[event(discriminator = [110, 134, 123, 30, 250, 53, 165, 164])]
pub struct AccountOracleChanged {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub state: MarketSnapshot,
}

#[event(discriminator = [138, 63, 159, 244, 107, 190, 119, 30])]
pub struct AccountOrderChanged {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub margin: Pubkey,
    pub state: MarginAccountSnapshot,
    pub markets: [MarketSnapshot; 2],
    pub liability_versions: [u64; 2],
}

#[event(discriminator = [69, 250, 247, 174, 178, 243, 46, 47])]
pub struct FundingPublisherChanged {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub configuration: Pubkey,
    pub state: crate::state::liquidity::FundingPublisherPayload,
    pub market_state: MarketSnapshot,
}

#[event(discriminator = [157, 0, 211, 150, 191, 4, 31, 22])]
pub struct FundingReportAccepted {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub publisher: Pubkey,
    pub report: crate::state::liquidity::FundingReport,
    pub state: MarketSnapshot,
}

#[event(discriminator = [251, 40, 242, 186, 173, 63, 170, 85])]
pub struct AccountAuthorityChanged {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub margin: Pubkey,
    pub state: MarginAccountSnapshot,
    pub liability_versions: [u64; 2],
}

#[event(discriminator = [56, 145, 24, 73, 218, 166, 221, 174])]
pub struct LiquidityRouteExecuted {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: MarketSnapshot,
    pub other_market_state: MarketSnapshot,
    pub nonce: u64,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub insurance_credit: u64,
    pub retained_fee: u64,
    pub carry_before: u8,
    pub carry_after: u8,
    pub ledger: MarketLedgerSnapshot,
    pub order_id: u64,
    pub order_version: u64,
    pub root_states: Vec<MarginAccountSnapshot>,
    pub maker_states: Vec<crate::state::liquidity::MakerRegistrationPayload>,
    pub total_cash: u64,
    pub liability_versions: [u64; 2],
    pub legs: Vec<crate::state::liquidity::ExecutedLeg>,
}

#[event(discriminator = [78, 191, 27, 88, 192, 34, 235, 128])]
pub struct AccountQualification {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub safety_epoch: u64,
    pub markets: [MarketSnapshot; 2],
}

#[event(discriminator = [76, 103, 155, 59, 195, 212, 214, 99])]
pub struct AccountFinancialChanged {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub actor: Pubkey,
    /// 0 withdrawal, 1 transfer, 2 collection, 3 payment, 4 flat netting,
    /// 5 retained fees allocated to insurance, 6 retained fee token withdrawal.
    pub kind: u8,
    pub market_index: u8,
    pub amount: u64,
    pub safety_epoch: u64,
    pub total_cash: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
    pub liability_versions: [u64; 2],
    pub roots: Vec<Pubkey>,
    pub root_states: Vec<MarginAccountSnapshot>,
    pub markets: [MarketSnapshot; 2],
    pub ledgers: [MarketLedgerSnapshot; 2],
}

#[event(discriminator = [66, 133, 138, 218, 88, 161, 206, 5])]
pub struct AccountBackingChanged {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub certificate: Pubkey,
    pub state: BackingSnapshot,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BackingSnapshot {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market_index: u8,
    pub safety_epoch: u64,
    pub membership_version: u64,
    pub liability_versions: [u64; 2],
    pub observations: [u64; 2],
    pub funding_bounds: [[i128; 2]; 2],
    pub source_deadlines: [i64; 2],
    pub required_market_mask: u8,
    pub count: u16,
    pub next: u16,
    pub cash: u64,
    pub lots: [i128; 2],
    pub claim_sum: i128,
    pub complete: bool,
    pub bump: u8,
}

impl From<&crate::state::accounts::SettlementCertificate> for BackingSnapshot {
    fn from(state: &crate::state::accounts::SettlementCertificate) -> Self {
        Self {
            schema_version: state.schema_version,
            venue: state.venue,
            market_index: state.market_index,
            safety_epoch: state.safety_epoch,
            membership_version: state.membership_version,
            liability_versions: state.liability_versions,
            observations: state.observations,
            funding_bounds: state.funding_bounds,
            source_deadlines: state.source_deadlines,
            required_market_mask: state.required_market_mask,
            count: state.count,
            next: state.next,
            cash: state.cash,
            lots: state.lots,
            claim_sum: state.claim_sum,
            complete: state.complete,
            bump: state.bump,
        }
    }
}

#[event(discriminator = [35, 131, 226, 210, 153, 126, 68, 34])]
pub struct AccountLiquidated {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub safety_epoch: u64,
    pub liability_versions: [u64; 2],
    pub market_index: u8,
    pub lots: u64,
    pub price: u64,
    pub fee: u64,
    pub deficit_before: i128,
    pub deficit_after: i128,
    pub target: Pubkey,
    pub receiver: Pubkey,
    pub target_state: MarginAccountSnapshot,
    pub receiver_state: MarginAccountSnapshot,
    pub markets: [MarketSnapshot; 2],
}

/// The complete frozen input header; wide derived work is emitted separately.
#[event(discriminator = [9, 69, 237, 92, 238, 192, 233, 138])]
pub struct AccountResolutionFrozen {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub stage: u8,
    pub trigger: Pubkey,
    pub emergency: bool,
    pub count: u16,
    pub registry_hash: [u8; 32],
    pub safety_epoch: u64,
    pub terms_epoch: u64,
    pub config_epochs: [u64; 2],
    pub source_observations: [u64; 2],
    pub source_deadlines: [i64; 2],
    pub prices: [u64; 2],
    pub funding: [i128; 2],
    pub frozen_at: i64,
    pub cash: u64,
    pub pools: [u64; 2],
    pub insurance: [u64; 2],
    pub fees: [u64; 2],
    pub allocated: u64,
    pub gross: [u64; 2],
    pub actual_vault: u64,
    pub markets: [MarketSnapshot; 2],
}

#[event(discriminator = [50, 162, 81, 145, 11, 220, 251, 122])]
pub struct AccountResolutionValued {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub id: u16,
    pub member: Pubkey,
    pub cash: u64,
    pub lots: [i64; 2],
    pub generations: [u64; 2],
    pub claims_scaled: [i128; 2],
    pub collected: u64,
}

#[event(discriminator = [95, 79, 7, 241, 6, 199, 46, 157])]
pub struct AccountResolutionProgress {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub processed_stage: u8,
    pub start: u16,
    pub length: u8,
    pub next_stage: u8,
    pub next_cursor: u16,
    pub evaluation: u8,
    pub clipped_mask: u8,
}

#[event(discriminator = [143, 137, 233, 117, 27, 179, 172, 62])]
pub struct AccountResolutionProposal {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub evaluation: u8,
    pub proposal_hash: [u8; 32],
    pub offset: u16,
    pub bytes: Vec<u8>,
    pub rejected: bool,
    pub next_stage: u8,
}

#[event(discriminator = [91, 235, 196, 127, 1, 112, 115, 135])]
pub struct AccountResolutionRates {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub evaluation: u8,
    pub proposal_hash: [u8; 32],
    /// 1 rejected/reset; 2 exact prescribed clipping; 3 complete verified rates.
    pub outcome: u8,
    pub next_evaluation: u8,
    pub clipped_mask: u8,
    pub budgets: [u64; 2],
    pub insurance_spent: [u64; 2],
}

#[event(discriminator = [104, 193, 251, 138, 199, 42, 223, 137])]
pub struct AccountResolutionPlanned {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub id: u16,
    pub member: Pubkey,
    pub flow_floors: [u64; 2],
    pub cash_floor: u64,
}

#[event(discriminator = [255, 128, 154, 229, 22, 34, 225, 38])]
pub struct AccountResolutionOrder {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub orders: [Vec<u16>; 2],
}

#[event(discriminator = [1, 231, 71, 83, 144, 31, 238, 83])]
pub struct AccountResolutionRounded {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub start: u16,
    pub complete: bool,
    pub required: u64,
    pub sent: u64,
    pub augmentations: u16,
    pub depth: u16,
}

#[event(discriminator = [235, 156, 190, 81, 243, 206, 170, 101])]
pub struct AccountResolutionApplied {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub id: u16,
    pub member: Pubkey,
    pub flows: [u64; 2],
    pub cash_before: u64,
    pub cash_after: u64,
    pub remaining_cash: u64,
    pub applied_cash: u64,
    pub remaining_lots: [i128; 2],
    pub remaining_gross: [u64; 2],
    pub remaining_claims: [i128; 2],
    pub state: MarginAccountSnapshot,
}

#[event(discriminator = [227, 126, 217, 202, 34, 46, 211, 23])]
pub struct AccountResolutionCompleted {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    pub stage: u8,
    pub mode: u8,
    pub safety_epoch: u64,
    pub cash: u64,
    pub pools: [u64; 2],
    pub insurance: [u64; 2],
    pub fees: [u64; 2],
    pub insurance_spent: [u64; 2],
    pub allocated: u64,
    pub actual_vault: u64,
    pub liability_versions: [u64; 2],
    pub ledger_versions: [u64; 2],
    pub insurance_fee_remainders: [u8; 2],
}

#[event(discriminator = [171, 93, 161, 145, 184, 243, 209, 202])]
pub struct AccountSafetyRecovery {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub epoch: u64,
    /// 0 observe, 1 resolved->custody, 2 explicit candidate reactivation.
    pub kind: u8,
    pub mode: u8,
    pub paused: bool,
    pub safety_epoch: u64,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub stage: u8,
    pub recovery_since: i64,
    pub recovery_last: i64,
    pub total_cash: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
    pub markets: [MarketSnapshot; 2],
}

#[event(discriminator = [51, 205, 34, 225, 187, 4, 113, 1])]
pub struct AccountRetirementProgress {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub safety_epoch: u64,
    pub membership_version: u64,
    pub count: u16,
    pub next: u16,
    pub cash: u64,
    pub complete: bool,
}

#[event(discriminator = [146, 20, 112, 36, 111, 171, 202, 245])]
pub struct AccountsRetired {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub safety_epoch: u64,
    pub terms_epoch: u64,
    pub count: u16,
    pub total_cash: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
}

#[event(discriminator = [167, 139, 59, 103, 37, 196, 95, 47])]
pub struct RetiredReserveWithdrawn {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub authority: Pubkey,
    pub destination: Pubkey,
    pub market_index: u8,
    pub amount: u64,
    pub insurance: u64,
    pub fees: u64,
    pub fee_remainder: u8,
    pub ledger_version: u64,
    pub total_cash: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
}

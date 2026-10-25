//! Critical event schemas consumed by the SDK and finalized indexer.
use crate::state::*;
use anchor_lang::prelude::*;

#[event]
pub struct OrderChanged {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    /// 0 place, 1 replace, 2 cancel, 3 protective pair, 4 cancel group, 5 cleanup.
    pub kind: u8,
    pub participant: Pubkey,
    pub order_id: u64,
    pub reserved: u64,
    pub order_ids: [u64; 4],
    pub book: OrderBook,
}

#[event]
pub struct MakerChanged {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub kind: u8,
    pub registration: Pubkey,
    pub capital: Pubkey,
    pub maker_id: u8,
    pub authority_epoch: u64,
    pub quote_epoch: u64,
    pub quarantined: bool,
    pub approved_hash: [u8; 32],
    pub config_epoch: u64,
}

#[event]
pub struct SettlementChanged {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub observation: u64,
    /// 0 collect loss, 1 settle gain, 2 withdraw funded cash.
    pub kind: u8,
    pub participant: Pubkey,
    pub amount: u64,
    pub participant_cash: u64,
    pub participant_virtual: i128,
    pub participant_reserved: u64,
    pub participant_order_ids: [u64; 4],
    pub participant_book: crate::state::OrderBook,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub total_cash: u64,
    pub settlement: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
}

#[event]
pub struct TestRiskPublished {
    pub version: u16,
    pub terms_epoch: u64,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub config_epoch: u64,
    pub observation_sequence: u64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecutedLeg {
    pub maker_id: u8,
    pub capital: Pubkey,
    pub lots: u64,
    pub gross_quote: u64,
    pub quote_epoch: u64,
    pub authority_epoch: u64,
    pub consumed_after: u64,
    pub position_after: i64,
    pub virtual_after: i128,
    pub generation_after: u64,
    pub reserved_after: u64,
    pub order_ids_after: [u64; 4],
    pub book_after: crate::state::OrderBook,
}

#[event]
pub struct RouteExecuted {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub slot: u64,
    pub observation_sequence: u64,
    pub trader: Pubkey,
    pub nonce: u64,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub trader_cash: u64,
    pub trader_lots: i64,
    pub trader_virtual: i128,
    pub trader_generation: u64,
    pub trader_reserved: u64,
    pub trader_order_ids: [u64; 4],
    pub trader_book: crate::state::OrderBook,
    pub order_id: u64,
    pub order_version: u64,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub total_cash: u64,
    pub total_fees: u64,
    pub gross_lots: u64,
    pub legs: Vec<ExecutedLeg>,
}

#[event]
pub struct CustodyChanged {
    pub schema_version: u16,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub slot: u64,
    /// 0 initialize, 1 register, 2 deposit, 3 withdraw, 4 insurance, 5 surplus, 6 pause.
    pub kind: u8,
    pub actor: Pubkey,
    /// Default pubkey means a market-wide event.
    pub participant: Pubkey,
    pub amount: u64,
    pub participant_cash: u64,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
    pub paused: bool,
}

#[event]
pub struct OracleObserved {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub observation_sequence: u64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub oracle: OracleState,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolutionUpdate {
    pub id: u16,
    pub row: ResolutionRow,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolutionParticipant {
    pub participant: Pubkey,
    pub id: u16,
    pub cash: u64,
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
    /// Apply invalidates all active orders, zeros reserves/IDs and group allowance.
    /// Collection leaves the full existing book and nonce unchanged.
    pub finalized: bool,
}

#[event]
pub struct ResolutionProgress {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub slot: u64,
    /// 0 freeze/reset rows, 1 page, 2 valuation/recovery check, 3 resume.
    pub kind: u8,
    pub mode: u8,
    pub paused: bool,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub allocated_vault: u64,
    pub gross_lots: u64,
    pub oracle: crate::state::OracleState,
    pub header: ResolutionHeader,
    pub rows: Vec<ResolutionUpdate>,
    pub participants: Vec<ResolutionParticipant>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RiskParticipant {
    pub participant: Pubkey,
    pub id: u16,
    pub cash: u64,
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
    pub nonce: u64,
    pub reserved: u64,
    pub order_ids: [u64; 4],
    pub book: OrderBook,
}

#[event]
pub struct LiquidationApplied {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub slot: u64,
    pub observation: u64,
    pub lots: u64,
    pub price: u64,
    pub fee: u64,
    pub deficit_before: i128,
    pub deficit_after: i128,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub gross_lots: u64,
    pub target: RiskParticipant,
    pub receiver: RiskParticipant,
}

#[event]
pub struct ProbeRecorded {
    pub schema_version: u16,
    pub owner: Pubkey,
    pub record: Pubkey,
    pub nonce: u64,
    pub signed_value: i128,
    pub optional_value: Option<u64>,
    pub choice: ProbeChoice,
}
/// V2 custody events are separate from V1's market-scoped journal.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GroupMemberCashV2 {
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

#[event]
pub struct GroupCustodyChangedV2 {
    pub schema_version: u16,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    /// 0 group, 1 market, 2 portfolio, 3 margin, 4 deposit, 5 withdraw,
    /// 6 internal transfer, 7 custody pause, 8 unsolicited surplus to insurance.
    pub kind: u8,
    pub actor: Pubkey,
    pub subject: Pubkey,
    pub index: u16,
    pub amount: u64,
    pub members: Vec<GroupMemberCashV2>,
    pub authority: Pubkey,
    pub quote_mint: Pubkey,
    pub vault: Pubkey,
    pub markets: [Pubkey; 2],
    pub market_count: u8,
    pub mode: u8,
    pub paused: bool,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub allocated_vault: u64,
    /// None when this operation does not read the token account.
    pub actual_vault: Option<u64>,
}

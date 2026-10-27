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
    /// 6 internal transfer, 7 unfrozen pause, 8 unsolicited surplus to insurance, 9 explicit fee allocation.
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

#[event]
pub struct GroupMakerChangedV2 {
    pub group: Pubkey,
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub config_epoch: u64,
    pub registration: Pubkey,
    pub state: MakerRegistrationSnapshotV2,
    pub operation: u8,
}

#[event]
pub struct GroupOracleChangedV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub state: GroupMarketSnapshotV2,
}

#[event]
pub struct MarginClaimsNettedV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub margin: Pubkey,
    pub state: MarginAccountSnapshotV2,
    pub markets: [GroupMarketSnapshotV2; 2],
    pub cancelled_scaled: i128,
}

#[event]
pub struct MarginAuthorityChangedV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub margin: Pubkey,
    pub state: MarginAccountSnapshotV2,
}

#[event]
pub struct MarginOrderChangedV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: GroupMarketSnapshotV2,
    pub margin: Pubkey,
    pub state: MarginAccountSnapshotV2,
    pub other_market: Pubkey,
    pub other_market_state: GroupMarketSnapshotV2,
}

#[event]
pub struct MarginRouteExecutedV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: GroupMarketSnapshotV2,
    pub nonce: u64,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub order_id: u64,
    pub order_version: u64,
    pub root_states: Vec<MarginAccountSnapshotV2>,
    pub maker_states: Vec<MakerRegistrationSnapshotV2>,
    pub total_cash: u64,
    pub fees: u64,
    pub other_market: Pubkey,
    pub other_market_state: GroupMarketSnapshotV2,
}

impl MarginOrderChangedV2 {
    #[inline(never)]
    pub(crate) fn with_other(
        change: GroupOrderChangedV2,
        other_market: Pubkey,
        other_market_state: GroupMarketSnapshotV2,
    ) -> Box<Self> {
        Box::new(Self {
            group: change.group,
            sequence: change.sequence,
            slot: change.slot,
            market: change.market,
            market_state: change.market_state,
            margin: change.margin,
            state: change.state,
            other_market,
            other_market_state,
        })
    }
}
impl MarginRouteExecutedV2 {
    #[inline(never)]
    pub(crate) fn with_other(
        execution: GroupRouteExecutedV2,
        other_market: Pubkey,
        other_market_state: GroupMarketSnapshotV2,
    ) -> Box<Self> {
        Box::new(Self {
            group: execution.group,
            sequence: execution.sequence,
            slot: execution.slot,
            market: execution.market,
            market_state: execution.market_state,
            nonce: execution.nonce,
            side: execution.side,
            lots: execution.lots,
            gross_quote: execution.gross_quote,
            fee: execution.fee,
            order_id: execution.order_id,
            order_version: execution.order_version,
            root_states: execution.root_states,
            maker_states: execution.maker_states,
            total_cash: execution.total_cash,
            fees: execution.fees,
            other_market,
            other_market_state,
        })
    }
}

#[event]
pub struct GroupOrderChangedV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: GroupMarketSnapshotV2,
    pub margin: Pubkey,
    pub state: MarginAccountSnapshotV2,
}

#[event]
pub struct GroupRouteExecutedV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: GroupMarketSnapshotV2,
    pub nonce: u64,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub order_id: u64,
    pub order_version: u64,
    /// At most three roots; keys derive from each immutable portfolio/child identity.
    pub root_states: Vec<MarginAccountSnapshotV2>,
    pub maker_states: Vec<MakerRegistrationSnapshotV2>,
    pub total_cash: u64,
    pub fees: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarginAccountSnapshotV2 {
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
    pub positions: [crate::state::v2::PositionV2; 2],
    pub nonce: u64,
    pub state_version: u64,
    pub delegate: Pubkey,
    pub delegate_expiry_slot: u64,
    pub delegate_epoch: u64,
    pub reserved: u64,
    pub book: crate::state::v2::OrderBookV2,
    pub bump: u8,
}

impl From<&crate::state::v2::MarginAccountV2> for MarginAccountSnapshotV2 {
    fn from(state: &crate::state::v2::MarginAccountV2) -> Self {
        Self {
            schema_version: state.schema_version,
            group: state.group,
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
pub struct GroupMarketSnapshotV2 {
    pub schema_version: u16,
    pub group: Pubkey,
    pub index: u8,
    pub symbol: [u8; 8],
    pub lots_per_unit: u64,
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

impl From<&crate::state::v2::GroupMarketV2> for GroupMarketSnapshotV2 {
    fn from(state: &crate::state::v2::GroupMarketV2) -> Self {
        Self {
            schema_version: state.schema_version,
            group: state.group,
            index: state.index,
            symbol: state.symbol,
            lots_per_unit: state.lots_per_unit,
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MakerRegistrationSnapshotV2 {
    pub schema_version: u16,
    pub group: Pubkey,
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

impl From<&crate::state::v2::MakerRegistrationV2> for MakerRegistrationSnapshotV2 {
    fn from(state: &crate::state::v2::MakerRegistrationV2) -> Self {
        Self {
            schema_version: state.schema_version,
            group: state.group,
            market: state.market,
            market_index: state.market_index,
            maker_id: state.maker_id,
            capital: state.capital,
            owner: state.owner,
            pricing_program: state.pricing_program,
            program_data: state.program_data,
            config: state.config,
            approved_hash: state.approved_hash,
            authority_epoch: state.authority_epoch,
            quote_epoch: state.quote_epoch,
            start_slot: state.start_slot,
            expiry_slot: state.expiry_slot,
            inventory_limit: state.inventory_limit,
            buy_consumed: state.buy_consumed,
            sell_consumed: state.sell_consumed,
            quarantined: state.quarantined,
            bump: state.bump,
        }
    }
}

#[event]
pub struct GroupSafetyChangedV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub mode: u8,
    pub paused: bool,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    /// 0 activate, 1 collect, 2 pay, 3 deposit, 4 withdraw, 5 transfer.
    pub kind: u8,
    pub amount: u64,
    pub roots: Vec<MarginAccountSnapshotV2>,
    pub markets: [GroupMarketSnapshotV2; 2],
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
}

#[event]
pub struct GroupLiquidationV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market_index: u8,
    pub lots: u64,
    pub price: u64,
    pub fee: u64,
    pub deficit_before: i128,
    pub deficit_after: i128,
    pub target: MarginAccountSnapshotV2,
    pub receiver: MarginAccountSnapshotV2,
    pub markets: [GroupMarketSnapshotV2; 2],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GroupResolutionUpdateV2 {
    pub id: u16,
    pub row: crate::state::v2::GroupResolutionRowV2,
}

#[event]
pub struct GroupResolutionProgressV2 {
    pub group: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub kind: u8,
    pub mode: u8,
    pub paused: bool,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub markets: [GroupMarketSnapshotV2; 2],
    pub header: crate::state::v2::GroupResolutionHeaderV2,
    pub rows: Vec<GroupResolutionUpdateV2>,
    pub roots: Vec<MarginAccountSnapshotV2>,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
}

/// Version-3 custody payloads are scalar snapshots, never nested account types.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AccountCashSnapshotV3 {
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
pub struct MarketLedgerSnapshotV3 {
    pub ledger: Pubkey,
    pub market: Pubkey,
    pub market_index: u8,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub insurance_fee_remainder: u8,
    pub version: u64,
}

#[event]
pub struct AccountCustodyChangedV3 {
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
    pub members: Vec<AccountCashSnapshotV3>,
    pub ledgers: Vec<MarketLedgerSnapshotV3>,
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
pub struct MarginAccountSnapshotV3 {
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
    pub positions: [crate::state::v2::PositionV2; 2],
    pub nonce: u64,
    pub state_version: u64,
    pub delegate: Pubkey,
    pub delegate_expiry_slot: u64,
    pub delegate_epoch: u64,
    pub reserved: u64,
    pub book: crate::state::v2::OrderBookV2,
    pub bump: u8,
}

impl From<&crate::state::v3::MarginAccountV3> for MarginAccountSnapshotV3 {
    fn from(state: &crate::state::v3::MarginAccountV3) -> Self {
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
pub struct MarketSnapshotV3 {
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

impl From<&crate::state::v3::MarketV3> for MarketSnapshotV3 {
    fn from(state: &crate::state::v3::MarketV3) -> Self {
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MakerRegistrationSnapshotV3 {
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

impl From<&crate::state::v3::MakerRegistrationV3> for MakerRegistrationSnapshotV3 {
    fn from(state: &crate::state::v3::MakerRegistrationV3) -> Self {
        Self {
            schema_version: state.schema_version,
            venue: state.venue,
            market: state.market,
            market_index: state.market_index,
            maker_id: state.maker_id,
            capital: state.capital,
            owner: state.owner,
            pricing_program: state.pricing_program,
            program_data: state.program_data,
            config: state.config,
            approved_hash: state.approved_hash,
            authority_epoch: state.authority_epoch,
            quote_epoch: state.quote_epoch,
            start_slot: state.start_slot,
            expiry_slot: state.expiry_slot,
            inventory_limit: state.inventory_limit,
            buy_consumed: state.buy_consumed,
            sell_consumed: state.sell_consumed,
            quarantined: state.quarantined,
            bump: state.bump,
        }
    }
}

#[event]
pub struct AccountMakerChangedV3 {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: MarketSnapshotV3,
    pub registration: Pubkey,
    pub state: MakerRegistrationSnapshotV3,
    pub operation: u8,
}

#[event]
pub struct AccountOracleChangedV3 {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub state: MarketSnapshotV3,
}

#[event]
pub struct AccountOrderChangedV3 {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub margin: Pubkey,
    pub state: MarginAccountSnapshotV3,
    pub markets: [MarketSnapshotV3; 2],
    pub liability_versions: [u64; 2],
}
#[event]
pub struct AccountAuthorityChangedV3 {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub margin: Pubkey,
    pub state: MarginAccountSnapshotV3,
    pub liability_versions: [u64; 2],
}

#[event]
pub struct AccountRouteExecutedV3 {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub market: Pubkey,
    pub market_state: MarketSnapshotV3,
    pub other_market_state: MarketSnapshotV3,
    pub nonce: u64,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub insurance_credit: u64,
    pub retained_fee: u64,
    pub carry_before: u8,
    pub carry_after: u8,
    pub ledger: MarketLedgerSnapshotV3,
    pub order_id: u64,
    pub order_version: u64,
    pub root_states: Vec<MarginAccountSnapshotV3>,
    pub maker_states: Vec<MakerRegistrationSnapshotV3>,
    pub total_cash: u64,
    pub liability_versions: [u64; 2],
}

#[event]
pub struct AccountQualificationV3 {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub safety_epoch: u64,
    pub markets: [MarketSnapshotV3; 2],
}

#[event]
pub struct AccountFinancialChangedV3 {
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
    pub root_states: Vec<MarginAccountSnapshotV3>,
    pub markets: [MarketSnapshotV3; 2],
    pub ledgers: [MarketLedgerSnapshotV3; 2],
}

#[event]
pub struct AccountBackingChangedV3 {
    pub venue: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub certificate: Pubkey,
    pub state: BackingSnapshotV3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BackingSnapshotV3 {
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

impl From<&crate::state::v3::SettlementCertificateV3> for BackingSnapshotV3 {
    fn from(state: &crate::state::v3::SettlementCertificateV3) -> Self {
        Self {schema_version: state.schema_version, venue: state.venue, market_index: state.market_index,
            safety_epoch: state.safety_epoch, membership_version: state.membership_version,
            liability_versions: state.liability_versions, observations: state.observations,
            funding_bounds: state.funding_bounds, source_deadlines: state.source_deadlines,
            required_market_mask: state.required_market_mask, count: state.count, next: state.next,
            cash: state.cash, lots: state.lots, claim_sum: state.claim_sum, complete: state.complete, bump: state.bump}
    }
}

#[event]
pub struct AccountLiquidatedV3 {
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
    pub target_state: MarginAccountSnapshotV3,
    pub receiver_state: MarginAccountSnapshotV3,
    pub markets: [MarketSnapshotV3; 2],
}
/// The complete frozen input header; wide derived work is emitted separately.
#[event]
pub struct AccountResolutionFrozenV3 {
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
}

#[event]
pub struct AccountResolutionValuedV3 {
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

#[event]
pub struct AccountResolutionProgressV3 {
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

#[event]
pub struct AccountResolutionProposalV3 {
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

#[event]
pub struct AccountResolutionRatesV3 {
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

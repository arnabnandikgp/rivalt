//! Instruction contexts, handlers and their domain-specific validation helpers.

pub mod orders;
pub use orders::{CancelOrder, CleanupOrders, ManageOrder};

pub mod group_custody;
pub(crate) use group_custody::{
    __client_accounts_control_group_v2, __client_accounts_create_portfolio_v2,
    __client_accounts_group_cash_transfer_v2, __client_accounts_initialize_group_market_v2,
    __client_accounts_initialize_group_v2, __client_accounts_register_margin_v2,
    __client_accounts_transfer_group_cash_v2,
};
#[cfg(feature = "cpi")]
pub(crate) use group_custody::{
    __cpi_client_accounts_control_group_v2, __cpi_client_accounts_create_portfolio_v2,
    __cpi_client_accounts_group_cash_transfer_v2, __cpi_client_accounts_initialize_group_market_v2,
    __cpi_client_accounts_initialize_group_v2, __cpi_client_accounts_register_margin_v2,
    __cpi_client_accounts_transfer_group_cash_v2,
};
pub use group_custody::{
    ControlGroupV2, CreatePortfolioV2, GroupCashTransferV2, InitializeGroupMarketV2,
    InitializeGroupV2, RegisterMarginV2, TransferGroupCashV2,
};

pub(crate) use orders::{
    __client_accounts_cancel_order, __client_accounts_cleanup_orders,
    __client_accounts_manage_order,
};

pub mod makers;
pub use makers::{ApproveMaker, PreviewMaker, QuarantineMaker, RegisterMaker, SyncMaker};

pub(crate) use makers::{
    __client_accounts_approve_maker, __client_accounts_preview_maker,
    __client_accounts_quarantine_maker, __client_accounts_register_maker,
    __client_accounts_sync_maker,
};

pub mod settlement;
pub use settlement::{CheckExitCohort, InitializeExitGuard, LedgerChange, WithdrawTrading};

pub(crate) use settlement::{
    __client_accounts_check_exit_cohort, __client_accounts_initialize_exit_guard,
    __client_accounts_ledger_change, __client_accounts_withdraw_trading,
};

pub mod routes;
pub use routes::{ExecuteOrder, ExecuteRoute, InitializeTestRoutes, PublishTestRisk};

pub(crate) use routes::{
    __client_accounts_execute_order, __client_accounts_execute_route,
    __client_accounts_initialize_test_routes, __client_accounts_publish_test_risk,
};

pub mod custody;
pub use custody::{
    CashTransfer, ControlMarket, FundInsurance, InitializeMarket, RegisterParticipant,
};

pub(crate) use custody::{
    __client_accounts_cash_transfer, __client_accounts_control_market,
    __client_accounts_fund_insurance, __client_accounts_initialize_market,
    __client_accounts_register_participant,
};

pub mod oracle;
pub use oracle::{InitializeOracle, SampleOracle};

pub(crate) use oracle::{__client_accounts_initialize_oracle, __client_accounts_sample_oracle};

pub mod resolution;
pub use resolution::{AdvanceResolution, FreezeMarket, InitializeResolution, RecoverResolution};

pub(crate) use resolution::{
    __client_accounts_advance_resolution, __client_accounts_freeze_market,
    __client_accounts_initialize_resolution, __client_accounts_recover_resolution,
};

pub mod risk;
pub use risk::Liquidate;

pub(crate) use risk::__client_accounts_liquidate;

pub mod probe;
pub use probe::Probe;

pub(crate) use probe::__client_accounts_probe;

pub use makers::PreviewArgs;

pub use orders::OrderTerms;

pub use routes::{OrderExecution, RouteIntent, RouteLeg};

// Anchor emits distinct account-meta modules for CPI clients. Keep both feature
// surfaces available at the crate root without glob-exporting handler helpers.
#[cfg(feature = "cpi")]
pub(crate) use custody::{
    __cpi_client_accounts_cash_transfer, __cpi_client_accounts_control_market,
    __cpi_client_accounts_fund_insurance, __cpi_client_accounts_initialize_market,
    __cpi_client_accounts_register_participant,
};
#[cfg(feature = "cpi")]
pub(crate) use makers::{
    __cpi_client_accounts_approve_maker, __cpi_client_accounts_preview_maker,
    __cpi_client_accounts_quarantine_maker, __cpi_client_accounts_register_maker,
    __cpi_client_accounts_sync_maker,
};
#[cfg(feature = "cpi")]
pub(crate) use oracle::{
    __cpi_client_accounts_initialize_oracle, __cpi_client_accounts_sample_oracle,
};
#[cfg(feature = "cpi")]
pub(crate) use orders::{
    __cpi_client_accounts_cancel_order, __cpi_client_accounts_cleanup_orders,
    __cpi_client_accounts_manage_order,
};
#[cfg(feature = "cpi")]
pub(crate) use probe::__cpi_client_accounts_probe;
#[cfg(feature = "cpi")]
pub(crate) use resolution::{
    __cpi_client_accounts_advance_resolution, __cpi_client_accounts_freeze_market,
    __cpi_client_accounts_initialize_resolution, __cpi_client_accounts_recover_resolution,
};
#[cfg(feature = "cpi")]
pub(crate) use risk::__cpi_client_accounts_liquidate;
#[cfg(feature = "cpi")]
pub(crate) use routes::{
    __cpi_client_accounts_execute_order, __cpi_client_accounts_execute_route,
    __cpi_client_accounts_initialize_test_routes, __cpi_client_accounts_publish_test_risk,
};
#[cfg(feature = "cpi")]
pub(crate) use settlement::{
    __cpi_client_accounts_check_exit_cohort, __cpi_client_accounts_initialize_exit_guard,
    __cpi_client_accounts_ledger_change, __cpi_client_accounts_withdraw_trading,
};

pub mod group_trading;
pub(crate) use group_trading::makers::{
    __client_accounts_preview_group_maker, __client_accounts_register_group_maker,
    __client_accounts_update_group_maker,
};
#[cfg(feature = "cpi")]
pub(crate) use group_trading::makers::{
    __cpi_client_accounts_preview_group_maker, __cpi_client_accounts_register_group_maker,
    __cpi_client_accounts_update_group_maker,
};
pub use group_trading::makers::{PreviewGroupMaker, RegisterGroupMaker, UpdateGroupMaker};
pub(crate) use group_trading::oracle::{
    __client_accounts_initialize_group_oracle, __client_accounts_sample_group_oracle,
};
#[cfg(feature = "cpi")]
pub(crate) use group_trading::oracle::{
    __cpi_client_accounts_initialize_group_oracle, __cpi_client_accounts_sample_group_oracle,
};
pub use group_trading::oracle::{InitializeGroupOracle, SampleGroupOracle};
pub use group_trading::routes::GroupOrderAction;
pub(crate) use group_trading::routes::{
    __client_accounts_execute_group_route, __client_accounts_manage_group_order,
};
#[cfg(feature = "cpi")]
pub(crate) use group_trading::routes::{
    __cpi_client_accounts_execute_group_route, __cpi_client_accounts_manage_group_order,
};
pub use group_trading::routes::{ExecuteGroupRoute, ManageGroupOrder};

pub mod group_margin;
pub(crate) use group_margin::authority::__client_accounts_set_margin_delegate;
#[cfg(feature = "cpi")]
pub(crate) use group_margin::authority::__cpi_client_accounts_set_margin_delegate;
pub use group_margin::authority::SetMarginDelegate;
pub(crate) use group_margin::netting::__client_accounts_net_margin_claims;
#[cfg(feature = "cpi")]
pub(crate) use group_margin::netting::__cpi_client_accounts_net_margin_claims;
pub use group_margin::netting::NetMarginClaims;
pub(crate) use group_margin::trading::{
    __client_accounts_execute_margin_route, __client_accounts_manage_margin_order,
};
#[cfg(feature = "cpi")]
pub(crate) use group_margin::trading::{
    __cpi_client_accounts_execute_margin_route, __cpi_client_accounts_manage_margin_order,
};
pub use group_margin::trading::{ExecuteMarginRoute, ManageMarginOrder};
pub mod group_safety;
pub(crate) use group_safety::resolution::{
    __client_accounts_advance_group_resolution, __client_accounts_freeze_group,
    __client_accounts_recover_group_resolution,
};
#[cfg(feature = "cpi")]
pub(crate) use group_safety::resolution::{
    __cpi_client_accounts_advance_group_resolution, __cpi_client_accounts_freeze_group,
    __cpi_client_accounts_recover_group_resolution,
};
pub use group_safety::resolution::{AdvanceGroupResolution, FreezeGroup, RecoverGroupResolution};
pub(crate) use group_safety::risk::__client_accounts_liquidate_group;
#[cfg(feature = "cpi")]
pub(crate) use group_safety::risk::__cpi_client_accounts_liquidate_group;
pub use group_safety::risk::LiquidateGroup;
pub(crate) use group_safety::settlement::{
    __client_accounts_activate_isolated_group, __client_accounts_change_group_claim,
    __client_accounts_check_group_exit, __client_accounts_group_trading_cash,
    __client_accounts_initialize_group_safety, __client_accounts_transfer_trading_cash,
};
#[cfg(feature = "cpi")]
pub(crate) use group_safety::settlement::{
    __cpi_client_accounts_activate_isolated_group, __cpi_client_accounts_change_group_claim,
    __cpi_client_accounts_check_group_exit, __cpi_client_accounts_group_trading_cash,
    __cpi_client_accounts_initialize_group_safety, __cpi_client_accounts_transfer_trading_cash,
};
pub use group_safety::settlement::{
    ActivateIsolatedGroup, ChangeGroupClaim, CheckGroupExit, GroupTradingCash,
    InitializeGroupSafety, TransferTradingCash,
};

pub mod account_custody;
pub(crate) use account_custody::{
    __client_accounts_account_cash_v3, __client_accounts_classify_market_surplus_v3,
    __client_accounts_create_portfolio_v3, __client_accounts_initialize_market_v3,
    __client_accounts_initialize_venue_registry_v3, __client_accounts_initialize_venue_v3,
    __client_accounts_pause_venue_v3, __client_accounts_register_margin_v3,
    __client_accounts_seed_market_insurance_v3, __client_accounts_transfer_account_custody_v3,
};
#[cfg(feature = "cpi")]
pub(crate) use account_custody::{
    __cpi_client_accounts_account_cash_v3, __cpi_client_accounts_classify_market_surplus_v3,
    __cpi_client_accounts_create_portfolio_v3, __cpi_client_accounts_initialize_market_v3,
    __cpi_client_accounts_initialize_venue_registry_v3, __cpi_client_accounts_initialize_venue_v3,
    __cpi_client_accounts_pause_venue_v3, __cpi_client_accounts_register_margin_v3,
    __cpi_client_accounts_seed_market_insurance_v3,
    __cpi_client_accounts_transfer_account_custody_v3,
};
pub use account_custody::{
    AccountCashV3, ClassifyMarketSurplusV3, CreatePortfolioV3, InitializeMarketV3,
    InitializeVenueRegistryV3, InitializeVenueV3, PauseVenueV3, RegisterMarginV3,
    SeedMarketInsuranceV3, TransferAccountCustodyV3,
};

//! Instruction contexts, handlers and their domain-specific validation helpers.

pub mod orders;
pub use orders::{CancelOrder, CleanupOrders, ManageOrder};

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

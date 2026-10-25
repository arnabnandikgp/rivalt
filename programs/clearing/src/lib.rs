//! Rivalt common clearing: public entrypoints delegate to instruction modules.
use anchor_lang::prelude::*;
use maker_interface::QuoteResponse;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
#[cfg(any(test, feature = "devnet-test-profile"))]
mod pyth_core;
pub mod state;

use constants::financial_profile;
pub use error::ClearingError;
pub use events::*;
pub use instructions::*;
pub use state::*;

#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo");

#[cfg(feature = "devnet-test-profile")]
declare_id!("BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv");

#[cfg(all(feature = "local-test-profile", feature = "devnet-test-profile"))]
compile_error!("local and devnet financial profiles are mutually exclusive");

/// Financial paths require an explicit, separate engineering profile.
#[program]
pub mod clearing {
    use super::*;

    pub fn initialize_group_v2(ctx: Context<InitializeGroupV2>, domain: [u8; 32]) -> Result<()> {
        group_custody::initialize(ctx, domain)
    }
    pub fn initialize_group_market_v2(
        ctx: Context<InitializeGroupMarketV2>,
        index: u8,
    ) -> Result<()> {
        group_custody::initialize_market(ctx, index)
    }
    pub fn create_portfolio_v2(ctx: Context<CreatePortfolioV2>, index: u16) -> Result<()> {
        group_custody::create_portfolio(ctx, index)
    }
    pub fn register_margin_v2(
        ctx: Context<RegisterMarginV2>,
        subaccount_index: u16,
        mode: u8,
        isolated_market_index: u8,
        role: u8,
    ) -> Result<()> {
        group_custody::register(ctx, subaccount_index, mode, isolated_market_index, role)
    }
    pub fn deposit_group_v2(ctx: Context<GroupCashTransferV2>, amount: u64) -> Result<()> {
        group_custody::cash(ctx, amount, false)
    }
    pub fn withdraw_group_custody_v2(ctx: Context<GroupCashTransferV2>, amount: u64) -> Result<()> {
        group_custody::cash(ctx, amount, true)
    }
    pub fn transfer_group_custody_v2(ctx: Context<TransferGroupCashV2>, amount: u64) -> Result<()> {
        group_custody::transfer(ctx, amount)
    }
    pub fn pause_group_custody_v2(ctx: Context<ControlGroupV2>, paused: bool) -> Result<()> {
        group_custody::pause(ctx, paused)
    }
    pub fn classify_group_surplus_v2(ctx: Context<ControlGroupV2>) -> Result<()> {
        group_custody::classify_surplus(ctx)
    }

    pub fn initialize_resolution(ctx: Context<InitializeResolution>) -> Result<()> {
        resolution::initialize(ctx)
    }
    pub fn freeze_market(
        ctx: Context<FreezeMarket>,
        sequence: u64,
        observation: u64,
        emergency: bool,
    ) -> Result<()> {
        resolution::freeze(ctx, sequence, observation, emergency)
    }
    pub fn advance_resolution(
        ctx: Context<AdvanceResolution>,
        epoch: u64,
        stage: u8,
        start: u16,
    ) -> Result<()> {
        resolution::advance(ctx, epoch, stage, start)
    }
    pub fn recover_resolution(
        ctx: Context<RecoverResolution>,
        epoch: u64,
        resume: bool,
    ) -> Result<()> {
        resolution::recover(ctx, epoch, resume)
    }
    pub fn liquidate(
        ctx: Context<Liquidate>,
        sequence: u64,
        observation: u64,
        lots: u64,
        price: u64,
    ) -> Result<()> {
        risk::liquidate(ctx, sequence, observation, lots, price)
    }
    pub fn place_order(
        ctx: Context<ManageOrder>,
        expected_id: u64,
        terms: OrderTerms,
    ) -> Result<()> {
        orders::place(ctx, expected_id, terms)
    }
    pub fn replace_order(
        ctx: Context<ManageOrder>,
        id: u64,
        version: u64,
        terms: OrderTerms,
    ) -> Result<()> {
        orders::replace(ctx, id, version, terms)
    }
    pub fn cancel_order(ctx: Context<CancelOrder>, id: u64, version: u64) -> Result<()> {
        orders::cancel(ctx, id, version)
    }
    pub fn place_protection(
        ctx: Context<ManageOrder>,
        expected_id: u64,
        tp: OrderTerms,
        sl: OrderTerms,
    ) -> Result<()> {
        orders::protect(ctx, expected_id, tp, sl)
    }
    pub fn cancel_protection(ctx: Context<CancelOrder>, group_id: u64, version: u64) -> Result<()> {
        orders::cancel_group(ctx, group_id, version)
    }
    pub fn cleanup_orders(ctx: Context<CleanupOrders>) -> Result<()> {
        orders::cleanup(ctx)
    }

    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        primary: Pubkey,
        guard: Pubkey,
    ) -> Result<()> {
        oracle::initialize(ctx, primary, guard)
    }
    pub fn sample_oracle(ctx: Context<SampleOracle>) -> Result<()> {
        oracle::sample(ctx)
    }

    pub fn initialize_exit_guard(ctx: Context<InitializeExitGuard>) -> Result<()> {
        settlement::initialize(ctx)
    }
    pub fn check_exit_cohort(
        ctx: Context<CheckExitCohort>,
        sequence: u64,
        observation: u64,
        start: u16,
    ) -> Result<()> {
        settlement::check(ctx, sequence, observation, start)
    }
    pub fn collect_loss(
        ctx: Context<LedgerChange>,
        sequence: u64,
        observation: u64,
        amount: u64,
    ) -> Result<()> {
        settlement::change(ctx, sequence, observation, amount, false)
    }
    pub fn settle_gain(
        ctx: Context<LedgerChange>,
        sequence: u64,
        observation: u64,
        amount: u64,
    ) -> Result<()> {
        settlement::change(ctx, sequence, observation, amount, true)
    }
    pub fn withdraw_trading(
        ctx: Context<WithdrawTrading>,
        sequence: u64,
        observation: u64,
        amount: u64,
    ) -> Result<()> {
        settlement::withdraw(ctx, sequence, observation, amount)
    }

    pub fn initialize_test_routes(
        ctx: Context<InitializeTestRoutes>,
        reference: u64,
        duration: u64,
    ) -> Result<()> {
        routes::initialize(ctx, reference, duration)
    }
    pub fn publish_test_risk(
        ctx: Context<PublishTestRisk>,
        reference: u64,
        duration: u64,
    ) -> Result<()> {
        routes::publish_risk(ctx, reference, duration)
    }
    pub fn execute_order(ctx: Context<ExecuteOrder>, args: OrderExecution) -> Result<()> {
        routes::execute_order(ctx, args)
    }
    pub fn execute_route(ctx: Context<ExecuteRoute>, intent: RouteIntent) -> Result<()> {
        routes::execute(ctx, intent)
    }
    pub fn register_maker(
        ctx: Context<RegisterMaker>,
        maker_id: u8,
        inventory_limit: u64,
    ) -> Result<()> {
        makers::register(ctx, maker_id, inventory_limit)
    }
    pub fn approve_maker(ctx: Context<ApproveMaker>) -> Result<()> {
        makers::approve(ctx)
    }
    pub fn sync_maker_epoch(ctx: Context<SyncMaker>) -> Result<()> {
        makers::sync(ctx)
    }
    pub fn quarantine_maker(ctx: Context<QuarantineMaker>) -> Result<()> {
        makers::quarantine(ctx)
    }
    pub fn preview_maker(ctx: Context<PreviewMaker>, args: PreviewArgs) -> Result<QuoteResponse> {
        makers::preview(ctx, args)
    }

    pub fn initialize_market(ctx: Context<InitializeMarket>, domain: [u8; 32]) -> Result<()> {
        custody::initialize(ctx, domain)
    }
    pub fn register_participant(ctx: Context<RegisterParticipant>) -> Result<()> {
        custody::register(ctx)
    }
    pub fn deposit(ctx: Context<CashTransfer>, amount: u64) -> Result<()> {
        custody::process_deposit(ctx, amount)
    }
    pub fn withdraw(ctx: Context<CashTransfer>, amount: u64) -> Result<()> {
        custody::process_withdraw(ctx, amount)
    }
    pub fn fund_insurance(ctx: Context<FundInsurance>, amount: u64) -> Result<()> {
        custody::process_fund_insurance(ctx, amount)
    }
    pub fn classify_surplus(ctx: Context<ControlMarket>) -> Result<()> {
        custody::process_classify_surplus(ctx)
    }
    pub fn set_custody_pause(ctx: Context<ControlMarket>, paused: bool) -> Result<()> {
        custody::set_pause(ctx, paused)
    }

    pub fn probe(
        ctx: Context<Probe>,
        nonce: u64,
        signed_value: i128,
        optional_value: Option<u64>,
        choice: ProbeChoice,
    ) -> Result<()> {
        probe::handle(ctx, nonce, signed_value, optional_value, choice)
    }
}

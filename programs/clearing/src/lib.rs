//! Rivalt common clearing: public entrypoints delegate to instruction modules.
use anchor_lang::prelude::*;
use maker_interface::QuoteResponse;

pub mod constants;
pub mod error;
mod event_cpi;
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

    pub fn initialize_funding_publisher_v4(
        ctx: Context<InitializeFundingPublisherV4>,
        publisher: Pubkey,
    ) -> Result<()> {
        maker_liquidity::publisher::initialize(ctx, publisher)
    }
    pub fn configure_funding_publisher_v4(
        ctx: Context<ConfigureFundingPublisherV4>,
        expected_authority: u64,
        publisher: Pubkey,
    ) -> Result<()> {
        maker_liquidity::publisher::configure(ctx, expected_authority, publisher)
    }
    pub fn publish_funding_report_v4(
        ctx: Context<PublishFundingReportV4>,
        report: state::v4::FundingReportV4,
    ) -> Result<()> {
        maker_liquidity::publisher::publish(ctx, report)
    }

    pub fn initialize_liquidity_v4(ctx: Context<InitializeLiquidityV4>) -> Result<()> {
        maker_liquidity::initialize(ctx)
    }
    pub fn initialize_liquidity_oracle_v4(ctx: Context<InitializeAccountOracle>, primary: Pubkey, guard: Pubkey) -> Result<()> {
        maker_liquidity::sampling::initialize(ctx, primary, guard)
    }
    pub fn sample_liquidity_v4(ctx: Context<SampleLiquidityV4>) -> Result<()> {
        maker_liquidity::sampling::sample(ctx)
    }
    pub fn register_liquidity_v4(ctx: Context<RegisterLiquidityV4>, instance: u8) -> Result<()> {
        maker_liquidity::register(ctx, instance)
    }
    pub fn seal_liquidity_v4(ctx: Context<SealLiquidityV4>) -> Result<()> {
        maker_liquidity::seal(ctx)
    }
    pub fn control_liquidity_v4(ctx: Context<ControlLiquidityV4>, expected_authority: u64,
        expected_control: u64, expected_shape: u64, action: maker_interface::canonical::CurveControlV4) -> Result<()> {
        maker_liquidity::control(ctx, expected_authority, expected_control, expected_shape, action)
    }
    pub fn replenish_liquidity_v4(ctx: Context<ControlLiquidityV4>, expected_authority: u64,
        expected_depth: u64, sides: u8) -> Result<()> {
        maker_liquidity::replenish(ctx, expected_authority, expected_depth, sides)
    }
    pub fn quarantine_liquidity_v4(ctx: Context<QuarantineLiquidityV4>, expected_authority: u64) -> Result<()> {
        maker_liquidity::quarantine(ctx, expected_authority)
    }
    pub fn approve_liquidity_v4(ctx: Context<ControlLiquidityV4>, expected_authority: u64) -> Result<()> {
        maker_liquidity::approve(ctx, expected_authority)
    }

    pub fn initialize_account_resolution_v3(ctx: Context<InitializeAccountResolutionV3>) -> Result<()> {
        account_safety::resolution::initialize(ctx)
    }
    pub fn initialize_account_resolution_page_v3(ctx: Context<InitializeAccountResolutionPageV3>, page_index: u16) -> Result<()> {
        account_safety::resolution::initialize_page(ctx, page_index)
    }
    pub fn freeze_accounts_v3(ctx: Context<FreezeAccountsV3>, safety_epoch: u64,
        resolution_epoch: u64, emergency: bool) -> Result<()> {
        account_safety::resolution::freeze(ctx, safety_epoch, resolution_epoch, emergency)
    }
    pub fn value_account_resolution_v3(ctx: Context<ValueAccountResolutionV3>, epoch: u64) -> Result<()> {
        account_safety::resolution::value_sources(ctx, epoch)
    }
    pub fn advance_account_resolution_v3(ctx: Context<AdvanceAccountResolutionV3>, epoch: u64,
        stage: u8, start: u16, length: u8) -> Result<()> {
        account_safety::resolution::advance(ctx, epoch, stage, start, length)
    }
    pub fn propose_account_resolution_v3(ctx: Context<ProposeAccountResolutionV3>, epoch: u64,
        evaluation: u8, proposal_hash: [u8; 32], offset: u16, bytes: Vec<u8>) -> Result<()> {
        account_safety::resolution::upload(ctx, epoch, evaluation, proposal_hash, offset, bytes)
    }
    pub fn order_account_resolution_v3(ctx: Context<ProposeAccountResolutionV3>, epoch: u64,
        orders: [Vec<u16>; 2]) -> Result<()> {
        account_safety::resolution::order(ctx, epoch, orders)
    }
    pub fn check_account_resolution_order_v3(ctx: Context<AdvanceAccountResolutionV3>, epoch: u64,
        start: u16) -> Result<()> {
        account_safety::resolution::check_order(ctx, epoch, start)
    }
    pub fn round_account_resolution_v3(ctx: Context<ProposeAccountResolutionV3>, epoch: u64,
        start: u16) -> Result<()> {
        account_safety::resolution::round(ctx, epoch, start)
    }
    pub fn recover_accounts_v3(ctx: Context<RecoverAccountsV3>, epoch: u64, resume: bool) -> Result<()> {
        account_safety::resolution::recover(ctx, epoch, resume)
    }
    pub fn finalize_account_resolution_rates_v3(ctx: Context<ProposeAccountResolutionV3>, epoch: u64) -> Result<()> {
        account_safety::resolution::finalize(ctx, epoch)
    }
    pub fn reactivate_accounts_v3(ctx: Context<RecoverAccountsV3>, epoch: u64) -> Result<()> {
        account_safety::resolution::reactivate(ctx, epoch)
    }
    pub fn initialize_account_retirement_v3(ctx: Context<InitializeAccountRetirementV3>) -> Result<()> {
        account_safety::resolution::retirement::initialize(ctx)
    }
    pub fn check_account_retirement_v3(ctx: Context<CheckAccountRetirementV3>, start: u16) -> Result<()> {
        account_safety::resolution::retirement::check(ctx, start)
    }
    pub fn retire_accounts_v3(ctx: Context<RetireAccountsV3>, safety_epoch: u64) -> Result<()> {
        account_safety::resolution::retirement::retire(ctx, safety_epoch)
    }
    pub fn withdraw_retired_reserve_v3(ctx: Context<WithdrawRetiredReserveV3>, market_index: u8, amount: u64) -> Result<()> {
        account_safety::resolution::retirement::withdraw(ctx, market_index, amount)
    }

    pub fn liquidate_account_v3(ctx: Context<LiquidateAccountV3>, target_guard: account_trading::authority::AccountGuardV3,
        receiver_guard: account_trading::authority::AccountGuardV3, market_index: u8, lots: u64, price: u64) -> Result<()> {
        account_safety::risk::liquidate(ctx, target_guard, receiver_guard, market_index, lots, price)
    }
    pub fn withdraw_funded_account_v3(ctx: Context<WithdrawFundedAccountV3>, guard: account_trading::authority::AccountGuardV3, amount: u64) -> Result<()> {
        account_cash::cash::withdraw(ctx, guard, amount)
    }
    pub fn transfer_funded_account_v3(ctx: Context<TransferFundedAccountV3>, guard: account_trading::authority::AccountGuardV3, amount: u64) -> Result<()> {
        account_cash::cash::transfer(ctx, guard, amount)
    }
    pub fn initialize_market_backing_v3(ctx: Context<InitializeMarketBackingV3>, market_index: u8) -> Result<()> {
        account_cash::certificate::initialize(ctx, market_index)
    }
    pub fn check_market_backing_v3(ctx: Context<CheckMarketBackingV3>, start: u16) -> Result<()> {
        account_cash::certificate::check(ctx, start)
    }
    pub fn collect_account_loss_v3(ctx: Context<ChangeAccountClaimV3>, market_index: u8, amount: u64) -> Result<()> {
        account_cash::claims::change(ctx, market_index, amount, false)
    }
    pub fn pay_account_gain_v3(ctx: Context<ChangeAccountClaimV3>, market_index: u8, amount: u64) -> Result<()> {
        account_cash::claims::change(ctx, market_index, amount, true)
    }
    pub fn net_account_claims_v3(ctx: Context<NetAccountClaimsV3>, guard: account_trading::authority::AccountGuardV3,
        source_market: u8, amount: u64) -> Result<()> {
        account_cash::claims::net(ctx, guard, source_market, amount)
    }
    pub fn allocate_market_fees_v3(ctx: Context<ManageMarketFeesV3>, market_index: u8, amount: u64) -> Result<()> {
        account_cash::fees::manage(ctx, market_index, amount, false)
    }
    pub fn withdraw_market_fees_v3(ctx: Context<ManageMarketFeesV3>, market_index: u8, amount: u64) -> Result<()> {
        account_cash::fees::manage(ctx, market_index, amount, true)
    }

    pub fn register_account_maker_v3(
        ctx: Context<RegisterAccountMaker>,
        maker_id: u8,
        inventory_limit: u64,
    ) -> Result<()> {
        account_trading::makers::register(ctx, maker_id, inventory_limit)
    }
    pub fn update_account_maker_v3(ctx: Context<UpdateAccountMaker>, operation: u8) -> Result<()> {
        account_trading::makers::update(ctx, operation)
    }
    pub fn preview_account_maker_v3(
        ctx: Context<PreviewAccountMaker>,
        args: PreviewArgs,
    ) -> Result<QuoteResponse> {
        account_trading::makers::preview(ctx, args)
    }
    pub fn initialize_account_oracle_v3(
        ctx: Context<InitializeAccountOracle>,
        primary: Pubkey,
        guard: Pubkey,
    ) -> Result<()> {
        account_trading::oracle::initialize(ctx, primary, guard)
    }
    pub fn sample_account_oracle_v3(ctx: Context<SampleAccountOracle>) -> Result<()> {
        account_trading::oracle::sample(ctx)
    }
    pub fn qualify_account_trading_v3(ctx: Context<QualifyAccountTradingV3>) -> Result<()> {
        account_trading::activation::qualify(ctx)
    }
    pub fn activate_accounts_v3(ctx: Context<ActivateAccountsV3>) -> Result<()> {
        account_trading::activation::activate(ctx)
    }
    pub fn manage_account_order_v3(
        ctx: Context<ManageAccountOrderV3>,
        guard: account_trading::authority::AccountGuardV3,
        market_index: u8,
        operation: group_trading::routes::GroupOrderAction,
    ) -> Result<()> {
        account_trading::authority::manage(ctx, guard, market_index, operation)
    }
    pub fn set_account_delegate_v3(
        ctx: Context<SetAccountDelegateV3>,
        guard: account_trading::authority::AccountGuardV3,
        delegate: Pubkey,
        expiry_slot: u64,
    ) -> Result<()> {
        account_trading::authority::delegate(ctx, guard, delegate, expiry_slot)
    }
    pub fn execute_account_route_v3(
        ctx: Context<ExecuteAccountRouteV3>,
        intent: account_trading::routes::AccountRouteIntentV3,
    ) -> Result<()> {
        account_trading::routes::execute(ctx, intent)
    }
    pub fn execute_account_order_v3(
        ctx: Context<ExecuteAccountRouteV3>,
        args: account_trading::routes::AccountOrderExecutionV3,
    ) -> Result<()> {
        account_trading::routes::execute_order(ctx, args)
    }

    pub fn initialize_liquidity_venue_v4(
        ctx: Context<InitializeVenueV3>,
        domain: [u8; 32],
        fee_authority: Pubkey,
        reserve_authority: Pubkey,
        reserve_destination_owner: Pubkey,
    ) -> Result<()> {
        account_custody::initialize_liquidity(ctx, domain, fee_authority, reserve_authority, reserve_destination_owner)
    }

    pub fn initialize_venue_v3(
        ctx: Context<InitializeVenueV3>,
        domain: [u8; 32],
        fee_authority: Pubkey,
        reserve_authority: Pubkey,
        reserve_destination_owner: Pubkey,
    ) -> Result<()> {
        account_custody::initialize(
            ctx,
            domain,
            fee_authority,
            reserve_authority,
            reserve_destination_owner,
        )
    }
    pub fn initialize_venue_registry_v3(ctx: Context<InitializeVenueRegistryV3>) -> Result<()> {
        account_custody::initialize_registry(ctx)
    }
    pub fn initialize_market_v3(ctx: Context<InitializeMarketV3>, index: u8) -> Result<()> {
        account_custody::initialize_market(ctx, index)
    }
    pub fn create_portfolio_v3(ctx: Context<CreatePortfolioV3>, index: u16) -> Result<()> {
        account_custody::create_portfolio(ctx, index)
    }
    pub fn register_margin_v3(
        ctx: Context<RegisterMarginV3>,
        subaccount_index: u16,
        mode: u8,
        isolated_market_index: u8,
        role: u8,
    ) -> Result<()> {
        account_custody::register(ctx, subaccount_index, mode, isolated_market_index, role)
    }
    pub fn deposit_account_v3(ctx: Context<AccountCashV3>, amount: u64) -> Result<()> {
        account_custody::cash(ctx, amount, false)
    }
    pub fn withdraw_account_custody_v3(ctx: Context<AccountCashV3>, amount: u64) -> Result<()> {
        account_custody::cash(ctx, amount, true)
    }
    pub fn transfer_account_custody_v3(
        ctx: Context<TransferAccountCustodyV3>,
        amount: u64,
    ) -> Result<()> {
        account_custody::transfer(ctx, amount)
    }
    pub fn pause_venue_v3(ctx: Context<PauseVenueV3>, paused: bool) -> Result<()> {
        account_custody::pause(ctx, paused)
    }
    pub fn classify_market_surplus_v3(
        ctx: Context<ClassifyMarketSurplusV3>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        account_custody::classify_surplus(ctx, market_index, amount)
    }
    pub fn seed_market_insurance_v3(
        ctx: Context<SeedMarketInsuranceV3>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        account_custody::seed_insurance(ctx, market_index, amount)
    }

    pub fn execute_margin_route_v2(
        ctx: Context<ExecuteMarginRoute>,
        sequence: u64,
        observations: [u64; 2],
        intent: RouteIntent,
    ) -> Result<()> {
        group_margin::trading::execute(ctx, sequence, observations, intent)
    }
    pub fn execute_margin_order_v2(
        ctx: Context<ExecuteMarginRoute>,
        sequence: u64,
        observations: [u64; 2],
        args: OrderExecution,
    ) -> Result<()> {
        group_margin::trading::execute_order(ctx, sequence, observations, args)
    }
    pub fn manage_margin_order_v2(
        ctx: Context<ManageMarginOrder>,
        sequence: u64,
        observations: [u64; 2],
        operation: GroupOrderAction,
    ) -> Result<()> {
        group_margin::trading::manage(ctx, sequence, observations, operation)
    }

    pub fn net_margin_claims_v2(
        ctx: Context<NetMarginClaims>,
        sequence: u64,
        observations: [u64; 2],
    ) -> Result<()> {
        group_margin::netting::net(ctx, sequence, observations)
    }

    pub fn set_margin_delegate_v2(
        ctx: Context<SetMarginDelegate>,
        delegate: Pubkey,
        expiry_slot: u64,
    ) -> Result<()> {
        group_margin::authority::set(ctx, delegate, expiry_slot)
    }

    pub fn allocate_group_fees_v2(ctx: Context<ControlGroupV2>, amount: u64) -> Result<()> {
        group_custody::allocate_fees(ctx, amount)
    }
    pub fn initialize_group_safety_v2(ctx: Context<InitializeGroupSafety>) -> Result<()> {
        group_safety::settlement::initialize(ctx)
    }
    pub fn activate_isolated_group_v2(ctx: Context<ActivateIsolatedGroup>) -> Result<()> {
        group_safety::settlement::activate(ctx)
    }
    pub fn activate_cross_group_v2(ctx: Context<ActivateIsolatedGroup>) -> Result<()> {
        group_safety::settlement::activate_cross(ctx)
    }
    pub fn check_group_exit_v2(
        ctx: Context<CheckGroupExit>,
        sequence: u64,
        observations: [u64; 2],
        start: u16,
    ) -> Result<()> {
        group_safety::settlement::check(ctx, sequence, observations, start)
    }
    pub fn change_group_claim_v2(
        ctx: Context<ChangeGroupClaim>,
        sequence: u64,
        observations: [u64; 2],
        market_index: u8,
        amount: u64,
        gain: bool,
    ) -> Result<()> {
        group_safety::settlement::change(ctx, sequence, observations, market_index, amount, gain)
    }
    pub fn group_trading_cash_v2(
        ctx: Context<GroupTradingCash>,
        sequence: u64,
        observations: [u64; 2],
        amount: u64,
        withdraw: bool,
    ) -> Result<()> {
        group_safety::settlement::cash(ctx, sequence, observations, amount, withdraw)
    }
    pub fn transfer_trading_cash_v2(
        ctx: Context<TransferTradingCash>,
        sequence: u64,
        observations: [u64; 2],
        amount: u64,
    ) -> Result<()> {
        group_safety::settlement::transfer(ctx, sequence, observations, amount)
    }
    pub fn liquidate_group_v2(
        ctx: Context<LiquidateGroup>,
        sequence: u64,
        observations: [u64; 2],
        market_index: u8,
        lots: u64,
        price: u64,
    ) -> Result<()> {
        group_safety::risk::liquidate(ctx, sequence, observations, market_index, lots, price)
    }
    pub fn freeze_group_v2(
        ctx: Context<FreezeGroup>,
        sequence: u64,
        observations: [u64; 2],
        emergency: bool,
    ) -> Result<()> {
        group_safety::resolution::freeze(ctx, sequence, observations, emergency)
    }
    pub fn advance_group_resolution_v2(
        ctx: Context<AdvanceGroupResolution>,
        epoch: u64,
        stage: u8,
        start: u16,
    ) -> Result<()> {
        group_safety::resolution::advance(ctx, epoch, stage, start)
    }
    pub fn recover_group_resolution_v2(
        ctx: Context<RecoverGroupResolution>,
        epoch: u64,
        resume: bool,
    ) -> Result<()> {
        group_safety::resolution::recover(ctx, epoch, resume)
    }

    pub fn register_group_maker_v2(
        ctx: Context<RegisterGroupMaker>,
        maker_id: u8,
        inventory_limit: u64,
    ) -> Result<()> {
        group_trading::makers::register(ctx, maker_id, inventory_limit)
    }
    pub fn update_group_maker_v2(ctx: Context<UpdateGroupMaker>, operation: u8) -> Result<()> {
        group_trading::makers::update(ctx, operation)
    }
    pub fn preview_group_maker_v2(
        ctx: Context<PreviewGroupMaker>,
        args: PreviewArgs,
    ) -> Result<QuoteResponse> {
        group_trading::makers::preview(ctx, args)
    }
    pub fn initialize_group_oracle_v2(
        ctx: Context<InitializeGroupOracle>,
        primary: Pubkey,
        guard: Pubkey,
    ) -> Result<()> {
        group_trading::oracle::initialize(ctx, primary, guard)
    }
    pub fn sample_group_oracle_v2(ctx: Context<SampleGroupOracle>) -> Result<()> {
        group_trading::oracle::sample(ctx)
    }
    pub fn manage_group_order_v2(
        ctx: Context<ManageGroupOrder>,
        operation: GroupOrderAction,
    ) -> Result<()> {
        group_trading::routes::manage(ctx, operation)
    }
    pub fn execute_group_route_v2(
        ctx: Context<ExecuteGroupRoute>,
        intent: RouteIntent,
    ) -> Result<()> {
        group_trading::routes::execute(ctx, intent)
    }
    pub fn execute_group_order_v2(
        ctx: Context<ExecuteGroupRoute>,
        args: OrderExecution,
    ) -> Result<()> {
        group_trading::routes::execute_order(ctx, args)
    }

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

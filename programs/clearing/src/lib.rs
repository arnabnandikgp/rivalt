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

    #[instruction(discriminator = [166, 6, 187, 7, 126, 14, 139, 6])]
    pub fn activate_liquidity(ctx: Context<ActivateAccounts>) -> Result<()> {
        account_trading::activation::activate_liquidity(ctx)
    }

    #[instruction(discriminator = [195, 172, 220, 84, 16, 82, 29, 7])]
    pub fn execute_liquidity_route(ctx: Context<ExecuteLiquidityRoute>, args: LiquidityRouteIntent) -> Result<()> {
        maker_liquidity::routes::execute(ctx, args)
    }
    #[instruction(discriminator = [212, 85, 15, 174, 43, 247, 199, 170])]
    pub fn execute_liquidity_order(ctx: Context<ExecuteLiquidityRoute>, args: LiquidityOrderExecution) -> Result<()> {
        maker_liquidity::routes::execute_order(ctx, args)
    }

    #[instruction(discriminator = [46, 125, 193, 138, 25, 29, 38, 77])]
    pub fn initialize_funding_publisher(
        ctx: Context<InitializeFundingPublisher>,
        publisher: Pubkey,
    ) -> Result<()> {
        maker_liquidity::publisher::initialize(ctx, publisher)
    }
    #[instruction(discriminator = [110, 142, 188, 144, 187, 218, 246, 26])]
    pub fn configure_funding_publisher(
        ctx: Context<ConfigureFundingPublisher>,
        expected_authority: u64,
        publisher: Pubkey,
    ) -> Result<()> {
        maker_liquidity::publisher::configure(ctx, expected_authority, publisher)
    }
    #[instruction(discriminator = [215, 24, 92, 183, 31, 114, 182, 177])]
    pub fn publish_funding_report(
        ctx: Context<PublishFundingReport>,
        report: state::liquidity::FundingReport,
    ) -> Result<()> {
        maker_liquidity::publisher::publish(ctx, report)
    }

    #[instruction(discriminator = [22, 214, 118, 0, 73, 219, 158, 150])]
    pub fn initialize_liquidity(ctx: Context<InitializeLiquidity>) -> Result<()> {
        maker_liquidity::initialize(ctx)
    }
    #[instruction(discriminator = [25, 98, 80, 222, 78, 170, 247, 2])]
    pub fn initialize_liquidity_oracle(ctx: Context<InitializeAccountOracle>, primary: Pubkey, guard: Pubkey) -> Result<()> {
        maker_liquidity::sampling::initialize(ctx, primary, guard)
    }
    #[instruction(discriminator = [9, 149, 124, 151, 174, 246, 56, 42])]
    pub fn sample_liquidity(ctx: Context<SampleLiquidity>) -> Result<()> {
        maker_liquidity::sampling::sample(ctx)
    }
    #[instruction(discriminator = [37, 201, 113, 79, 246, 27, 211, 123])]
    pub fn register_liquidity(ctx: Context<RegisterLiquidity>, instance: u8) -> Result<()> {
        maker_liquidity::register(ctx, instance)
    }
    #[instruction(discriminator = [9, 220, 8, 208, 93, 107, 35, 66])]
    pub fn seal_liquidity(ctx: Context<SealLiquidity>) -> Result<()> {
        maker_liquidity::seal(ctx)
    }
    #[instruction(discriminator = [62, 198, 177, 103, 93, 48, 182, 192])]
    pub fn control_liquidity(ctx: Context<ControlLiquidity>, expected_authority: u64,
        expected_control: u64, expected_shape: u64, action: maker_interface::canonical::CurveControl) -> Result<()> {
        maker_liquidity::control(ctx, expected_authority, expected_control, expected_shape, action)
    }
    #[instruction(discriminator = [137, 189, 163, 68, 161, 179, 13, 220])]
    pub fn replenish_liquidity(ctx: Context<ControlLiquidity>, expected_authority: u64,
        expected_depth: u64, sides: u8) -> Result<()> {
        maker_liquidity::replenish(ctx, expected_authority, expected_depth, sides)
    }
    #[instruction(discriminator = [241, 172, 102, 0, 106, 204, 141, 71])]
    pub fn quarantine_liquidity(ctx: Context<QuarantineLiquidity>, expected_authority: u64) -> Result<()> {
        maker_liquidity::quarantine(ctx, expected_authority)
    }
    #[instruction(discriminator = [136, 174, 199, 147, 44, 36, 124, 250])]
    pub fn approve_liquidity(ctx: Context<ControlLiquidity>, expected_authority: u64) -> Result<()> {
        maker_liquidity::approve(ctx, expected_authority)
    }

    #[instruction(discriminator = [154, 81, 209, 77, 98, 252, 111, 116])]
    pub fn initialize_account_resolution(ctx: Context<InitializeAccountResolution>) -> Result<()> {
        account_safety::resolution::initialize(ctx)
    }
    #[instruction(discriminator = [128, 207, 5, 82, 159, 26, 204, 242])]
    pub fn initialize_account_resolution_page(ctx: Context<InitializeAccountResolutionPage>, page_index: u16) -> Result<()> {
        account_safety::resolution::initialize_page(ctx, page_index)
    }
    #[instruction(discriminator = [79, 20, 170, 245, 139, 183, 183, 204])]
    pub fn freeze_accounts(ctx: Context<FreezeAccounts>, safety_epoch: u64,
        resolution_epoch: u64, emergency: bool) -> Result<()> {
        account_safety::resolution::freeze(ctx, safety_epoch, resolution_epoch, emergency)
    }
    #[instruction(discriminator = [139, 215, 4, 127, 183, 174, 98, 189])]
    pub fn value_account_resolution(ctx: Context<ValueAccountResolution>, epoch: u64) -> Result<()> {
        account_safety::resolution::value_sources(ctx, epoch)
    }
    #[instruction(discriminator = [158, 125, 88, 198, 4, 88, 115, 45])]
    pub fn advance_account_resolution(ctx: Context<AdvanceAccountResolution>, epoch: u64,
        stage: u8, start: u16, length: u8) -> Result<()> {
        account_safety::resolution::advance(ctx, epoch, stage, start, length)
    }
    #[instruction(discriminator = [117, 16, 202, 186, 1, 19, 96, 124])]
    pub fn propose_account_resolution(ctx: Context<ProposeAccountResolution>, epoch: u64,
        evaluation: u8, proposal_hash: [u8; 32], offset: u16, bytes: Vec<u8>) -> Result<()> {
        account_safety::resolution::upload(ctx, epoch, evaluation, proposal_hash, offset, bytes)
    }
    #[instruction(discriminator = [97, 21, 211, 203, 242, 247, 254, 77])]
    pub fn order_account_resolution(ctx: Context<ProposeAccountResolution>, epoch: u64,
        orders: [Vec<u16>; 2]) -> Result<()> {
        account_safety::resolution::order(ctx, epoch, orders)
    }
    #[instruction(discriminator = [24, 254, 55, 247, 185, 141, 200, 14])]
    pub fn check_account_resolution_order(ctx: Context<AdvanceAccountResolution>, epoch: u64,
        start: u16) -> Result<()> {
        account_safety::resolution::check_order(ctx, epoch, start)
    }
    #[instruction(discriminator = [190, 79, 178, 22, 255, 147, 201, 4])]
    pub fn round_account_resolution(ctx: Context<ProposeAccountResolution>, epoch: u64,
        start: u16) -> Result<()> {
        account_safety::resolution::round(ctx, epoch, start)
    }
    #[instruction(discriminator = [219, 239, 15, 207, 243, 222, 93, 67])]
    pub fn recover_accounts(ctx: Context<RecoverAccounts>, epoch: u64, resume: bool) -> Result<()> {
        account_safety::resolution::recover(ctx, epoch, resume)
    }
    #[instruction(discriminator = [159, 255, 180, 192, 47, 160, 38, 65])]
    pub fn finalize_account_resolution_rates(ctx: Context<ProposeAccountResolution>, epoch: u64) -> Result<()> {
        account_safety::resolution::finalize(ctx, epoch)
    }
    #[instruction(discriminator = [148, 196, 189, 82, 173, 14, 171, 133])]
    pub fn reactivate_accounts(ctx: Context<RecoverAccounts>, epoch: u64) -> Result<()> {
        account_safety::resolution::reactivate(ctx, epoch)
    }
    #[instruction(discriminator = [174, 156, 215, 5, 24, 22, 39, 120])]
    pub fn initialize_account_retirement(ctx: Context<InitializeAccountRetirement>) -> Result<()> {
        account_safety::resolution::retirement::initialize(ctx)
    }
    #[instruction(discriminator = [112, 48, 16, 181, 151, 67, 89, 101])]
    pub fn check_account_retirement(ctx: Context<CheckAccountRetirement>, start: u16) -> Result<()> {
        account_safety::resolution::retirement::check(ctx, start)
    }
    #[instruction(discriminator = [233, 54, 212, 73, 41, 95, 248, 60])]
    pub fn retire_accounts(ctx: Context<RetireAccounts>, safety_epoch: u64) -> Result<()> {
        account_safety::resolution::retirement::retire(ctx, safety_epoch)
    }
    #[instruction(discriminator = [128, 169, 190, 185, 100, 109, 194, 197])]
    pub fn withdraw_retired_reserve(ctx: Context<WithdrawRetiredReserve>, market_index: u8, amount: u64) -> Result<()> {
        account_safety::resolution::retirement::withdraw(ctx, market_index, amount)
    }

    #[instruction(discriminator = [131, 207, 144, 94, 233, 148, 193, 145])]
    pub fn liquidate_account(ctx: Context<LiquidateAccount>, target_guard: account_trading::authority::AccountGuard,
        receiver_guard: account_trading::authority::AccountGuard, market_index: u8, lots: u64, price: u64) -> Result<()> {
        account_safety::risk::liquidate(ctx, target_guard, receiver_guard, market_index, lots, price)
    }
    #[instruction(discriminator = [182, 227, 227, 227, 105, 250, 114, 82])]
    pub fn withdraw_funded_account(ctx: Context<WithdrawFundedAccount>, guard: account_trading::authority::AccountGuard, amount: u64) -> Result<()> {
        account_cash::cash::withdraw(ctx, guard, amount)
    }
    #[instruction(discriminator = [192, 145, 33, 83, 250, 178, 221, 180])]
    pub fn transfer_funded_account(ctx: Context<TransferFundedAccount>, guard: account_trading::authority::AccountGuard, amount: u64) -> Result<()> {
        account_cash::cash::transfer(ctx, guard, amount)
    }
    #[instruction(discriminator = [83, 98, 92, 176, 125, 128, 185, 8])]
    pub fn initialize_market_backing(ctx: Context<InitializeMarketBacking>, market_index: u8) -> Result<()> {
        account_cash::certificate::initialize(ctx, market_index)
    }
    #[instruction(discriminator = [21, 81, 56, 88, 183, 171, 83, 40])]
    pub fn check_market_backing(ctx: Context<CheckMarketBacking>, start: u16) -> Result<()> {
        account_cash::certificate::check(ctx, start)
    }
    #[instruction(discriminator = [233, 57, 152, 62, 151, 36, 207, 224])]
    pub fn collect_account_loss(ctx: Context<ChangeAccountClaim>, market_index: u8, amount: u64) -> Result<()> {
        account_cash::claims::change(ctx, market_index, amount, false)
    }
    #[instruction(discriminator = [10, 28, 10, 104, 114, 129, 158, 42])]
    pub fn pay_account_gain(ctx: Context<ChangeAccountClaim>, market_index: u8, amount: u64) -> Result<()> {
        account_cash::claims::change(ctx, market_index, amount, true)
    }
    #[instruction(discriminator = [177, 49, 114, 141, 189, 12, 64, 79])]
    pub fn net_account_claims(ctx: Context<NetAccountClaims>, guard: account_trading::authority::AccountGuard,
        source_market: u8, amount: u64) -> Result<()> {
        account_cash::claims::net(ctx, guard, source_market, amount)
    }
    #[instruction(discriminator = [73, 100, 212, 184, 126, 4, 162, 29])]
    pub fn allocate_market_fees(ctx: Context<ManageMarketFees>, market_index: u8, amount: u64) -> Result<()> {
        account_cash::fees::manage(ctx, market_index, amount, false)
    }
    #[instruction(discriminator = [236, 141, 236, 121, 133, 175, 96, 152])]
    pub fn withdraw_market_fees(ctx: Context<ManageMarketFees>, market_index: u8, amount: u64) -> Result<()> {
        account_cash::fees::manage(ctx, market_index, amount, true)
    }

    #[instruction(discriminator = [136, 50, 227, 15, 132, 196, 125, 61])]
    pub fn register_account_maker(
        ctx: Context<RegisterAccountMaker>,
        maker_id: u8,
        inventory_limit: u64,
    ) -> Result<()> {
        account_trading::makers::register(ctx, maker_id, inventory_limit)
    }
    #[instruction(discriminator = [9, 35, 59, 247, 110, 33, 195, 33])]
    pub fn update_account_maker(ctx: Context<UpdateAccountMaker>, operation: u8) -> Result<()> {
        account_trading::makers::update(ctx, operation)
    }
    #[instruction(discriminator = [4, 9, 219, 208, 111, 237, 103, 157])]
    pub fn preview_account_maker(
        ctx: Context<PreviewAccountMaker>,
        args: PreviewArgs,
    ) -> Result<QuoteResponse> {
        account_trading::makers::preview(ctx, args)
    }
    #[instruction(discriminator = [58, 25, 84, 47, 225, 194, 103, 162])]
    pub fn initialize_account_oracle(
        ctx: Context<InitializeAccountOracle>,
        primary: Pubkey,
        guard: Pubkey,
    ) -> Result<()> {
        account_trading::oracle::initialize(ctx, primary, guard)
    }
    #[instruction(discriminator = [85, 241, 43, 118, 197, 109, 150, 171])]
    pub fn sample_account_oracle(ctx: Context<SampleAccountOracle>) -> Result<()> {
        account_trading::oracle::sample(ctx)
    }
    #[instruction(discriminator = [198, 106, 71, 214, 196, 62, 118, 65])]
    pub fn qualify_account_trading(ctx: Context<QualifyAccountTrading>) -> Result<()> {
        account_trading::activation::qualify(ctx)
    }
    #[instruction(discriminator = [30, 109, 231, 197, 224, 144, 237, 202])]
    pub fn activate_accounts(ctx: Context<ActivateAccounts>) -> Result<()> {
        account_trading::activation::activate(ctx)
    }
    #[instruction(discriminator = [222, 137, 80, 44, 228, 144, 103, 165])]
    pub fn manage_account_order(
        ctx: Context<ManageAccountOrder>,
        guard: account_trading::authority::AccountGuard,
        market_index: u8,
        operation: group_trading::routes::GroupOrderAction,
    ) -> Result<()> {
        account_trading::authority::manage(ctx, guard, market_index, operation)
    }
    #[instruction(discriminator = [250, 140, 65, 24, 51, 121, 96, 88])]
    pub fn set_account_delegate(
        ctx: Context<SetAccountDelegate>,
        guard: account_trading::authority::AccountGuard,
        delegate: Pubkey,
        expiry_slot: u64,
    ) -> Result<()> {
        account_trading::authority::delegate(ctx, guard, delegate, expiry_slot)
    }
    #[instruction(discriminator = [19, 140, 42, 107, 134, 174, 49, 183])]
    pub fn execute_account_route(
        ctx: Context<ExecuteAccountRoute>,
        intent: account_trading::routes::AccountRouteIntent,
    ) -> Result<()> {
        account_trading::routes::execute(ctx, intent)
    }
    #[instruction(discriminator = [227, 81, 78, 150, 222, 178, 206, 229])]
    pub fn execute_account_order(
        ctx: Context<ExecuteAccountRoute>,
        args: account_trading::routes::AccountOrderExecution,
    ) -> Result<()> {
        account_trading::routes::execute_order(ctx, args)
    }

    #[instruction(discriminator = [250, 122, 16, 167, 236, 144, 173, 143])]
    pub fn initialize_liquidity_venue(
        ctx: Context<InitializeVenue>,
        domain: [u8; 32],
        fee_authority: Pubkey,
        reserve_authority: Pubkey,
        reserve_destination_owner: Pubkey,
    ) -> Result<()> {
        account_custody::initialize_liquidity(ctx, domain, fee_authority, reserve_authority, reserve_destination_owner)
    }

    #[instruction(discriminator = [184, 183, 92, 124, 237, 161, 136, 192])]
    pub fn initialize_venue(
        ctx: Context<InitializeVenue>,
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
    #[instruction(discriminator = [102, 230, 6, 145, 112, 93, 102, 185])]
    pub fn initialize_venue_registry(ctx: Context<InitializeVenueRegistry>) -> Result<()> {
        account_custody::initialize_registry(ctx)
    }
    #[instruction(discriminator = [239, 190, 155, 70, 222, 88, 62, 74])]
    pub fn initialize_market(ctx: Context<InitializeMarket>, index: u8) -> Result<()> {
        account_custody::initialize_market(ctx, index)
    }
    #[instruction(discriminator = [190, 83, 131, 136, 246, 233, 81, 198])]
    pub fn create_portfolio(ctx: Context<CreatePortfolio>, index: u16) -> Result<()> {
        account_custody::create_portfolio(ctx, index)
    }
    #[instruction(discriminator = [18, 5, 57, 115, 223, 186, 54, 240])]
    pub fn register_margin(
        ctx: Context<RegisterMargin>,
        subaccount_index: u16,
        mode: u8,
        isolated_market_index: u8,
        role: u8,
    ) -> Result<()> {
        account_custody::register(ctx, subaccount_index, mode, isolated_market_index, role)
    }
    #[instruction(discriminator = [135, 248, 38, 135, 220, 118, 42, 215])]
    pub fn deposit_account(ctx: Context<AccountCash>, amount: u64) -> Result<()> {
        account_custody::cash(ctx, amount, false)
    }
    #[instruction(discriminator = [8, 125, 77, 6, 124, 105, 113, 123])]
    pub fn withdraw_account_custody(ctx: Context<AccountCash>, amount: u64) -> Result<()> {
        account_custody::cash(ctx, amount, true)
    }
    #[instruction(discriminator = [95, 81, 42, 204, 234, 182, 15, 18])]
    pub fn transfer_account_custody(
        ctx: Context<TransferAccountCustody>,
        amount: u64,
    ) -> Result<()> {
        account_custody::transfer(ctx, amount)
    }
    #[instruction(discriminator = [249, 14, 93, 103, 186, 72, 200, 112])]
    pub fn pause_venue(ctx: Context<PauseVenue>, paused: bool) -> Result<()> {
        account_custody::pause(ctx, paused)
    }
    #[instruction(discriminator = [167, 119, 199, 63, 133, 98, 213, 253])]
    pub fn classify_market_surplus(
        ctx: Context<ClassifyMarketSurplus>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        account_custody::classify_surplus(ctx, market_index, amount)
    }
    #[instruction(discriminator = [152, 240, 176, 200, 131, 225, 171, 192])]
    pub fn seed_market_insurance(
        ctx: Context<SeedMarketInsurance>,
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

    #[instruction(discriminator = [35, 35, 189, 193, 155, 48, 170, 203])]
    pub fn initialize_legacy_market(ctx: Context<InitializeLegacyMarket>, domain: [u8; 32]) -> Result<()> {
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

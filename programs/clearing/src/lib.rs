//! Rivalt common clearing: public entrypoints delegate to instruction modules.
use anchor_lang::prelude::*;

pub mod constants;
pub mod engine;
pub mod error;
mod event_cpi;
pub mod events;
pub mod instructions;
#[cfg(any(test, feature = "devnet-test-profile"))]
mod pyth_core;
mod scoped_history;
pub mod state;

pub use error::ClearingError;
pub use events::*;
pub use instructions::*;
pub use state::*;

#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo");

#[cfg(feature = "devnet-test-profile")]
declare_id!("BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv");

#[cfg(all(
    feature = "liquidity-execution-qualification",
    feature = "devnet-test-profile"
))]
compile_error!("local and devnet financial profiles are mutually exclusive");

/// Financial paths require the explicit qualified local profile.
#[program]
pub mod clearing {
    use super::*;

    #[instruction(discriminator = [166, 6, 187, 7, 126, 14, 139, 6])]
    pub fn activate_liquidity(ctx: Context<ActivateAccounts>) -> Result<()> {
        scoped_history::run(
            ctx,
            [166, 6, 187, 7, 126, 14, 139, 6],
            false,
            |ctx, events| account_trading::activation::activate_liquidity(ctx, events),
        )
    }

    #[instruction(discriminator = [158, 125, 88, 198, 4, 88, 115, 45])]
    pub fn advance_account_resolution(
        ctx: Context<AdvanceAccountResolution>,
        epoch: u64,
        stage: u8,
        start: u16,
        length: u8,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [158, 125, 88, 198, 4, 88, 115, 45],
            stage == account_safety::resolution::APPLY,
            |ctx, events| {
                account_safety::resolution::advance(ctx, events, epoch, stage, start, length)
            },
        )
    }

    #[instruction(discriminator = [73, 100, 212, 184, 126, 4, 162, 29])]
    pub fn allocate_market_fees(
        ctx: Context<ManageMarketFees>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [73, 100, 212, 184, 126, 4, 162, 29],
            false,
            |ctx, events| account_cash::fees::manage(ctx, events, market_index, amount, false),
        )
    }

    #[instruction(discriminator = [136, 174, 199, 147, 44, 36, 124, 250])]
    pub fn approve_liquidity(
        ctx: Context<ControlLiquidity>,
        expected_authority: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [136, 174, 199, 147, 44, 36, 124, 250],
            false,
            |ctx, events| maker_liquidity::approve(ctx, events, expected_authority),
        )
    }

    #[instruction(discriminator = [24, 254, 55, 247, 185, 141, 200, 14])]
    pub fn check_account_resolution_order(
        ctx: Context<AdvanceAccountResolution>,
        epoch: u64,
        start: u16,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [24, 254, 55, 247, 185, 141, 200, 14],
            false,
            |ctx, events| account_safety::resolution::check_order(ctx, events, epoch, start),
        )
    }

    #[instruction(discriminator = [112, 48, 16, 181, 151, 67, 89, 101])]
    pub fn check_account_retirement(
        ctx: Context<CheckAccountRetirement>,
        start: u16,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [112, 48, 16, 181, 151, 67, 89, 101],
            false,
            |ctx, events| account_safety::resolution::retirement::check(ctx, events, start),
        )
    }

    #[instruction(discriminator = [21, 81, 56, 88, 183, 171, 83, 40])]
    pub fn check_market_backing(ctx: Context<CheckMarketBacking>, start: u16) -> Result<()> {
        scoped_history::run(
            ctx,
            [21, 81, 56, 88, 183, 171, 83, 40],
            false,
            |ctx, events| account_cash::certificate::check(ctx, events, start),
        )
    }

    #[instruction(discriminator = [167, 119, 199, 63, 133, 98, 213, 253])]
    pub fn classify_market_surplus(
        ctx: Context<ClassifyMarketSurplus>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [167, 119, 199, 63, 133, 98, 213, 253],
            false,
            |ctx, events| account_custody::classify_surplus(ctx, events, market_index, amount),
        )
    }

    #[instruction(discriminator = [233, 57, 152, 62, 151, 36, 207, 224])]
    pub fn collect_account_loss(
        ctx: Context<ChangeAccountClaim>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [233, 57, 152, 62, 151, 36, 207, 224],
            false,
            |ctx, events| account_cash::claims::change(ctx, events, market_index, amount, false),
        )
    }

    #[instruction(discriminator = [110, 142, 188, 144, 187, 218, 246, 26])]
    pub fn configure_funding_publisher(
        ctx: Context<ConfigureFundingPublisher>,
        expected_authority: u64,
        publisher: Pubkey,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [110, 142, 188, 144, 187, 218, 246, 26],
            false,
            |ctx, events| {
                maker_liquidity::publisher::configure(ctx, events, expected_authority, publisher)
            },
        )
    }

    #[instruction(discriminator = [62, 198, 177, 103, 93, 48, 182, 192])]
    pub fn control_liquidity(
        ctx: Context<ControlLiquidity>,
        expected_authority: u64,
        expected_control: u64,
        expected_shape: u64,
        action: maker_interface::canonical::CurveControl,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [62, 198, 177, 103, 93, 48, 182, 192],
            false,
            |ctx, events| {
                maker_liquidity::control(
                    ctx,
                    events,
                    expected_authority,
                    expected_control,
                    expected_shape,
                    action,
                )
            },
        )
    }

    #[instruction(discriminator = [190, 83, 131, 136, 246, 233, 81, 198])]
    pub fn create_portfolio(ctx: Context<CreatePortfolio>, index: u16) -> Result<()> {
        scoped_history::run(
            ctx,
            [190, 83, 131, 136, 246, 233, 81, 198],
            false,
            |ctx, events| account_custody::create_portfolio(ctx, events, index),
        )
    }

    #[instruction(discriminator = [135, 248, 38, 135, 220, 118, 42, 215])]
    pub fn deposit_account(ctx: Context<AccountCash>, amount: u64) -> Result<()> {
        scoped_history::run(
            ctx,
            [135, 248, 38, 135, 220, 118, 42, 215],
            false,
            |ctx, events| account_custody::cash(ctx, events, amount, false),
        )
    }

    #[instruction(discriminator = [212, 85, 15, 174, 43, 247, 199, 170])]
    pub fn execute_liquidity_order(
        ctx: Context<ExecuteLiquidityRoute>,
        args: LiquidityOrderExecution,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [212, 85, 15, 174, 43, 247, 199, 170],
            false,
            |ctx, events| maker_liquidity::routes::execute_order(ctx, events, args),
        )
    }

    #[instruction(discriminator = [195, 172, 220, 84, 16, 82, 29, 7])]
    pub fn execute_liquidity_route(
        ctx: Context<ExecuteLiquidityRoute>,
        args: LiquidityRouteIntent,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [195, 172, 220, 84, 16, 82, 29, 7],
            false,
            |ctx, events| maker_liquidity::routes::execute(ctx, events, args),
        )
    }

    #[instruction(discriminator = [159, 255, 180, 192, 47, 160, 38, 65])]
    pub fn finalize_account_resolution_rates(
        ctx: Context<ProposeAccountResolution>,
        epoch: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [159, 255, 180, 192, 47, 160, 38, 65],
            false,
            |ctx, events| account_safety::resolution::finalize(ctx, events, epoch),
        )
    }

    #[instruction(discriminator = [79, 20, 170, 245, 139, 183, 183, 204])]
    pub fn freeze_accounts(
        ctx: Context<FreezeAccounts>,
        safety_epoch: u64,
        resolution_epoch: u64,
        emergency: bool,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [79, 20, 170, 245, 139, 183, 183, 204],
            false,
            |ctx, events| {
                account_safety::resolution::freeze(
                    ctx,
                    events,
                    safety_epoch,
                    resolution_epoch,
                    emergency,
                )
            },
        )
    }

    #[instruction(discriminator = [154, 81, 209, 77, 98, 252, 111, 116])]
    pub fn initialize_account_resolution(ctx: Context<InitializeAccountResolution>) -> Result<()> {
        scoped_history::run(
            ctx,
            [154, 81, 209, 77, 98, 252, 111, 116],
            false,
            |ctx, events| account_safety::resolution::initialize(ctx, events),
        )
    }

    #[instruction(discriminator = [128, 207, 5, 82, 159, 26, 204, 242])]
    pub fn initialize_account_resolution_page(
        ctx: Context<InitializeAccountResolutionPage>,
        page_index: u16,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [128, 207, 5, 82, 159, 26, 204, 242],
            false,
            |ctx, events| account_safety::resolution::initialize_page(ctx, events, page_index),
        )
    }

    #[instruction(discriminator = [174, 156, 215, 5, 24, 22, 39, 120])]
    pub fn initialize_account_retirement(ctx: Context<InitializeAccountRetirement>) -> Result<()> {
        scoped_history::run(
            ctx,
            [174, 156, 215, 5, 24, 22, 39, 120],
            false,
            |ctx, events| account_safety::resolution::retirement::initialize(ctx, events),
        )
    }

    #[instruction(discriminator = [46, 125, 193, 138, 25, 29, 38, 77])]
    pub fn initialize_funding_publisher(
        ctx: Context<InitializeFundingPublisher>,
        publisher: Pubkey,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [46, 125, 193, 138, 25, 29, 38, 77],
            false,
            |ctx, events| maker_liquidity::publisher::initialize(ctx, events, publisher),
        )
    }

    #[instruction(discriminator = [22, 214, 118, 0, 73, 219, 158, 150])]
    pub fn initialize_liquidity(ctx: Context<InitializeLiquidity>) -> Result<()> {
        scoped_history::run(
            ctx,
            [22, 214, 118, 0, 73, 219, 158, 150],
            false,
            |ctx, events| maker_liquidity::initialize(ctx, events),
        )
    }

    #[instruction(discriminator = [25, 98, 80, 222, 78, 170, 247, 2])]
    pub fn initialize_liquidity_oracle(
        ctx: Context<InitializeAccountOracle>,
        primary: Pubkey,
        guard: Pubkey,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [25, 98, 80, 222, 78, 170, 247, 2],
            false,
            |ctx, events| maker_liquidity::sampling::initialize(ctx, events, primary, guard),
        )
    }

    #[instruction(discriminator = [250, 122, 16, 167, 236, 144, 173, 143])]
    pub fn initialize_liquidity_venue(
        ctx: Context<InitializeVenue>,
        domain: [u8; 32],
        fee_authority: Pubkey,
        reserve_authority: Pubkey,
        reserve_destination_owner: Pubkey,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [250, 122, 16, 167, 236, 144, 173, 143],
            false,
            |ctx, events| {
                account_custody::initialize_liquidity(
                    ctx,
                    events,
                    domain,
                    fee_authority,
                    reserve_authority,
                    reserve_destination_owner,
                )
            },
        )
    }

    #[instruction(discriminator = [239, 190, 155, 70, 222, 88, 62, 74])]
    pub fn initialize_market(ctx: Context<InitializeMarket>, index: u8) -> Result<()> {
        scoped_history::run(
            ctx,
            [239, 190, 155, 70, 222, 88, 62, 74],
            false,
            |ctx, events| account_custody::initialize_market(ctx, events, index),
        )
    }

    #[instruction(discriminator = [83, 98, 92, 176, 125, 128, 185, 8])]
    pub fn initialize_market_backing(
        ctx: Context<InitializeMarketBacking>,
        market_index: u8,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [83, 98, 92, 176, 125, 128, 185, 8],
            false,
            |ctx, events| account_cash::certificate::initialize(ctx, events, market_index),
        )
    }

    #[instruction(discriminator = [102, 230, 6, 145, 112, 93, 102, 185])]
    pub fn initialize_venue_registry(ctx: Context<InitializeVenueRegistry>) -> Result<()> {
        scoped_history::run(
            ctx,
            [102, 230, 6, 145, 112, 93, 102, 185],
            false,
            |ctx, events| account_custody::initialize_registry(ctx, events),
        )
    }

    #[instruction(discriminator = [131, 207, 144, 94, 233, 148, 193, 145])]
    pub fn liquidate_account(
        ctx: Context<LiquidateAccount>,
        target_guard: account_trading::authority::AccountGuard,
        receiver_guard: account_trading::authority::AccountGuard,
        market_index: u8,
        lots: u64,
        price: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [131, 207, 144, 94, 233, 148, 193, 145],
            false,
            |ctx, events| {
                account_safety::risk::liquidate(
                    ctx,
                    events,
                    target_guard,
                    receiver_guard,
                    market_index,
                    lots,
                    price,
                )
            },
        )
    }

    #[instruction(discriminator = [222, 137, 80, 44, 228, 144, 103, 165])]
    pub fn manage_account_order(
        ctx: Context<ManageAccountOrder>,
        guard: account_trading::authority::AccountGuard,
        market_index: u8,
        operation: engine::routes::OrderAction,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [222, 137, 80, 44, 228, 144, 103, 165],
            false,
            |ctx, events| {
                account_trading::authority::manage(ctx, events, guard, market_index, operation)
            },
        )
    }

    #[instruction(discriminator = [177, 49, 114, 141, 189, 12, 64, 79])]
    pub fn net_account_claims(
        ctx: Context<NetAccountClaims>,
        guard: account_trading::authority::AccountGuard,
        source_market: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [177, 49, 114, 141, 189, 12, 64, 79],
            false,
            |ctx, events| account_cash::claims::net(ctx, events, guard, source_market, amount),
        )
    }

    #[instruction(discriminator = [97, 21, 211, 203, 242, 247, 254, 77])]
    pub fn order_account_resolution(
        ctx: Context<ProposeAccountResolution>,
        epoch: u64,
        orders: [Vec<u16>; 2],
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [97, 21, 211, 203, 242, 247, 254, 77],
            false,
            |ctx, events| account_safety::resolution::order(ctx, events, epoch, orders),
        )
    }

    #[instruction(discriminator = [249, 14, 93, 103, 186, 72, 200, 112])]
    pub fn pause_venue(ctx: Context<PauseVenue>, paused: bool) -> Result<()> {
        scoped_history::run(
            ctx,
            [249, 14, 93, 103, 186, 72, 200, 112],
            false,
            |ctx, events| account_custody::pause(ctx, events, paused),
        )
    }

    #[instruction(discriminator = [10, 28, 10, 104, 114, 129, 158, 42])]
    pub fn pay_account_gain(
        ctx: Context<ChangeAccountClaim>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [10, 28, 10, 104, 114, 129, 158, 42],
            false,
            |ctx, events| account_cash::claims::change(ctx, events, market_index, amount, true),
        )
    }

    #[instruction(discriminator = [117, 16, 202, 186, 1, 19, 96, 124])]
    pub fn propose_account_resolution(
        ctx: Context<ProposeAccountResolution>,
        epoch: u64,
        evaluation: u8,
        proposal_hash: [u8; 32],
        offset: u16,
        bytes: Vec<u8>,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [117, 16, 202, 186, 1, 19, 96, 124],
            false,
            |ctx, events| {
                account_safety::resolution::upload(
                    ctx,
                    events,
                    epoch,
                    evaluation,
                    proposal_hash,
                    offset,
                    bytes,
                )
            },
        )
    }

    #[instruction(discriminator = [215, 24, 92, 183, 31, 114, 182, 177])]
    pub fn publish_funding_report(
        ctx: Context<PublishFundingReport>,
        report: state::liquidity::FundingReport,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [215, 24, 92, 183, 31, 114, 182, 177],
            false,
            |ctx, events| maker_liquidity::publisher::publish(ctx, events, report),
        )
    }

    #[instruction(discriminator = [241, 172, 102, 0, 106, 204, 141, 71])]
    pub fn quarantine_liquidity(
        ctx: Context<QuarantineLiquidity>,
        expected_authority: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [241, 172, 102, 0, 106, 204, 141, 71],
            false,
            |ctx, events| maker_liquidity::quarantine(ctx, events, expected_authority),
        )
    }

    #[instruction(discriminator = [148, 196, 189, 82, 173, 14, 171, 133])]
    pub fn reactivate_accounts(ctx: Context<RecoverAccounts>, epoch: u64) -> Result<()> {
        scoped_history::run(
            ctx,
            [148, 196, 189, 82, 173, 14, 171, 133],
            false,
            |ctx, events| account_safety::resolution::reactivate(ctx, events, epoch),
        )
    }

    #[instruction(discriminator = [219, 239, 15, 207, 243, 222, 93, 67])]
    pub fn recover_accounts(ctx: Context<RecoverAccounts>, epoch: u64, resume: bool) -> Result<()> {
        scoped_history::run(
            ctx,
            [219, 239, 15, 207, 243, 222, 93, 67],
            false,
            |ctx, events| account_safety::resolution::recover(ctx, events, epoch, resume),
        )
    }

    #[instruction(discriminator = [37, 201, 113, 79, 246, 27, 211, 123])]
    pub fn register_liquidity(ctx: Context<RegisterLiquidity>, instance: u8) -> Result<()> {
        scoped_history::run(
            ctx,
            [37, 201, 113, 79, 246, 27, 211, 123],
            false,
            |ctx, events| maker_liquidity::register(ctx, events, instance),
        )
    }

    #[instruction(discriminator = [18, 5, 57, 115, 223, 186, 54, 240])]
    pub fn register_margin(
        ctx: Context<RegisterMargin>,
        subaccount_index: u16,
        mode: u8,
        isolated_market_index: u8,
        role: u8,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [18, 5, 57, 115, 223, 186, 54, 240],
            false,
            |ctx, events| {
                account_custody::register(
                    ctx,
                    events,
                    subaccount_index,
                    mode,
                    isolated_market_index,
                    role,
                )
            },
        )
    }

    #[instruction(discriminator = [137, 189, 163, 68, 161, 179, 13, 220])]
    pub fn replenish_liquidity(
        ctx: Context<ControlLiquidity>,
        expected_authority: u64,
        expected_depth: u64,
        sides: u8,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [137, 189, 163, 68, 161, 179, 13, 220],
            false,
            |ctx, events| {
                maker_liquidity::replenish(ctx, events, expected_authority, expected_depth, sides)
            },
        )
    }

    #[instruction(discriminator = [233, 54, 212, 73, 41, 95, 248, 60])]
    pub fn retire_accounts(ctx: Context<RetireAccounts>, safety_epoch: u64) -> Result<()> {
        scoped_history::run(
            ctx,
            [233, 54, 212, 73, 41, 95, 248, 60],
            false,
            |ctx, events| account_safety::resolution::retirement::retire(ctx, events, safety_epoch),
        )
    }

    #[instruction(discriminator = [190, 79, 178, 22, 255, 147, 201, 4])]
    pub fn round_account_resolution(
        ctx: Context<ProposeAccountResolution>,
        epoch: u64,
        start: u16,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [190, 79, 178, 22, 255, 147, 201, 4],
            false,
            |ctx, events| account_safety::resolution::round(ctx, events, epoch, start),
        )
    }

    #[instruction(discriminator = [9, 220, 8, 208, 93, 107, 35, 66])]
    pub fn seal_liquidity(ctx: Context<SealLiquidity>) -> Result<()> {
        scoped_history::run(
            ctx,
            [9, 220, 8, 208, 93, 107, 35, 66],
            false,
            |ctx, events| maker_liquidity::seal(ctx, events),
        )
    }

    #[instruction(discriminator = [152, 240, 176, 200, 131, 225, 171, 192])]
    pub fn seed_market_insurance(
        ctx: Context<SeedMarketInsurance>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [152, 240, 176, 200, 131, 225, 171, 192],
            false,
            |ctx, events| account_custody::seed_insurance(ctx, events, market_index, amount),
        )
    }

    #[instruction(discriminator = [250, 140, 65, 24, 51, 121, 96, 88])]
    pub fn set_account_delegate(
        ctx: Context<SetAccountDelegate>,
        guard: account_trading::authority::AccountGuard,
        delegate: Pubkey,
        expiry_slot: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [250, 140, 65, 24, 51, 121, 96, 88],
            false,
            |ctx, events| {
                account_trading::authority::delegate(ctx, events, guard, delegate, expiry_slot)
            },
        )
    }

    #[instruction(discriminator = [95, 81, 42, 204, 234, 182, 15, 18])]
    pub fn transfer_account_custody(
        ctx: Context<TransferAccountCustody>,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [95, 81, 42, 204, 234, 182, 15, 18],
            false,
            |ctx, events| account_custody::transfer(ctx, events, amount),
        )
    }

    #[instruction(discriminator = [192, 145, 33, 83, 250, 178, 221, 180])]
    pub fn transfer_funded_account(
        ctx: Context<TransferFundedAccount>,
        guard: account_trading::authority::AccountGuard,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [192, 145, 33, 83, 250, 178, 221, 180],
            false,
            |ctx, events| account_cash::cash::transfer(ctx, events, guard, amount),
        )
    }

    #[instruction(discriminator = [139, 215, 4, 127, 183, 174, 98, 189])]
    pub fn value_account_resolution(
        ctx: Context<ValueAccountResolution>,
        epoch: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [139, 215, 4, 127, 183, 174, 98, 189],
            false,
            |ctx, events| account_safety::resolution::value_sources(ctx, events, epoch),
        )
    }

    #[instruction(discriminator = [8, 125, 77, 6, 124, 105, 113, 123])]
    pub fn withdraw_account_custody(ctx: Context<AccountCash>, amount: u64) -> Result<()> {
        scoped_history::run(
            ctx,
            [8, 125, 77, 6, 124, 105, 113, 123],
            false,
            |ctx, events| account_custody::cash(ctx, events, amount, true),
        )
    }

    #[instruction(discriminator = [182, 227, 227, 227, 105, 250, 114, 82])]
    pub fn withdraw_funded_account(
        ctx: Context<WithdrawFundedAccount>,
        guard: account_trading::authority::AccountGuard,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [182, 227, 227, 227, 105, 250, 114, 82],
            false,
            |ctx, events| account_cash::cash::withdraw(ctx, events, guard, amount),
        )
    }

    #[instruction(discriminator = [236, 141, 236, 121, 133, 175, 96, 152])]
    pub fn withdraw_market_fees(
        ctx: Context<ManageMarketFees>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [236, 141, 236, 121, 133, 175, 96, 152],
            false,
            |ctx, events| account_cash::fees::manage(ctx, events, market_index, amount, true),
        )
    }

    #[instruction(discriminator = [128, 169, 190, 185, 100, 109, 194, 197])]
    pub fn withdraw_retired_reserve(
        ctx: Context<WithdrawRetiredReserve>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [128, 169, 190, 185, 100, 109, 194, 197],
            false,
            |ctx, events| {
                account_safety::resolution::retirement::withdraw(ctx, events, market_index, amount)
            },
        )
    }
}

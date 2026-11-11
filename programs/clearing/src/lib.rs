//! Rivalt common clearing: public entrypoints delegate to instruction modules.
use anchor_lang::prelude::*;

// Erased completely from ordinary artifacts. Diagnostic markers attribute costs;
// they do not replace uninstrumented before/after transaction measurements.
macro_rules! profile_cu {
    ($label:literal) => {
        #[cfg(feature = "cu-profiling")]
        {
            anchor_lang::prelude::msg!(concat!("RIVALT_CU:", $label));
            // The pinned Pinocchio runtime exposes this pointer-free logging syscall.
            #[cfg(target_os = "solana")]
            unsafe {
                anchor_lang::pinocchio::syscalls::sol_log_compute_units_();
            }
        }
    };
}

#[cfg(all(
    feature = "cu-profiling",
    not(feature = "liquidity-execution-qualification")
))]
compile_error!("CU tracing requires the explicit bounded local qualification profile");

pub mod constants;
pub mod engine;
pub mod error;
mod event_cpi;
pub mod events;
pub mod instructions;
mod program_accounts;
#[cfg(any(test, feature = "devnet-test-profile"))]
mod pyth_core;
mod scoped_history;
#[cfg(test)]
mod test_support;
mod wire;
pub use program_accounts::{ClearingProgram, ProgramData, UpgradeableProgramAddress};
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
// Consumers import state only; RC2 no-entrypoint alone still exports a dispatch symbol.
#[cfg(not(feature = "state-only"))]
#[program]
pub mod clearing {
    use super::*;
    pub fn initialize_recovery_storage(ctx: &mut Context<InitializeRecoveryStorage>) -> Result<()> {
        scoped_history::run(ctx, [106, 158, 29, 233, 151, 19, 14, 179], false, |ctx, _events| account_membership::provision::initialize(ctx))
    }
    pub fn begin_recovery_provision(ctx: &mut Context<ConfigureRecoveryStorage>, capacity: u64, revision: u64) -> Result<()> {
        scoped_history::run(ctx, [135, 74, 63, 142, 165, 222, 140, 251], false, |ctx, _events| account_membership::provision::begin(ctx, capacity, revision))
    }
    pub fn cancel_recovery_provision(ctx: &mut Context<ConfigureRecoveryStorage>, generation: u64, revision: u64) -> Result<()> {
        scoped_history::run(ctx, [16, 233, 73, 117, 122, 173, 100, 221], false, |ctx, _events| account_membership::provision::cancel(ctx, generation, revision))
    }
    pub fn fund_recovery_allocation(ctx: &mut Context<FundRecoveryAllocation>, kind: u8, register: u32, page: u64, generation: u64, ordinal: u64) -> Result<()> {
        scoped_history::run(ctx, [244, 52, 71, 227, 190, 76, 39, 38], false, |ctx, _events| account_membership::provision::fund(ctx, kind, register, page, generation, ordinal))
    }
    pub fn verify_recovery_allocation(ctx: &mut Context<VerifyRecoveryAllocation>, generation: u64, ordinal: u64, revision: u64) -> Result<()> {
        scoped_history::run(ctx, [204, 213, 63, 59, 88, 246, 243, 60], false, |ctx, _events| account_membership::provision::verify(ctx, generation, ordinal, revision))
    }
    pub fn initialize_prepared_settlement(
        ctx: &mut Context<InitializePreparedSettlement>,
        epoch: u64,
        source_revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [142, 95, 113, 145, 69, 54, 206, 110],
            false,
            |ctx, _events| account_safety::settlement::initialize(ctx, epoch, source_revision),
        )
    }
    pub fn initialize_prepared_index_node(
        ctx: &mut Context<InitializePreparedIndexNode>,
        epoch: u64,
        level: u8,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [117, 16, 8, 101, 140, 193, 196, 138],
            false,
            |ctx, _events| account_safety::settlement::initialize_node(ctx, epoch, level, revision),
        )
    }
    pub fn initialize_prepared_members(
        ctx: &mut Context<InitializePreparedMembers>,
        epoch: u64,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [173, 221, 142, 20, 24, 134, 194, 65],
            false,
            |ctx, _events| account_safety::settlement::initialize_members(ctx, epoch, revision),
        )
    }
    pub fn initialize_frozen_margin_page(
        ctx: &mut Context<InitializeFrozenMarginPage>,
        epoch: u64,
        page_index: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [94, 60, 255, 32, 23, 190, 156, 212],
            false,
            |ctx, _events| account_safety::settlement::initialize_rows(ctx, epoch, page_index),
        )
    }
    pub fn advance_prepared_membership(
        ctx: &mut Context<AdvancePreparedMembership>,
        epoch: u64,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [195, 174, 1, 137, 171, 6, 115, 191],
            false,
            |ctx, _events| account_safety::settlement::advance_membership(ctx, epoch, revision),
        )
    }
    pub fn value_prepared_member(
        ctx: &mut Context<ValuePreparedMember>,
        epoch: u64,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [0, 175, 17, 162, 157, 181, 195, 149],
            false,
            |ctx, _events| account_safety::settlement::value(ctx, epoch, revision),
        )
    }
    pub fn initialize_settlement_limb_page(
        ctx: &mut Context<InitializeSettlementLimbPage>,
        epoch: u64,
        register: u32,
        page_index: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [120, 231, 48, 106, 72, 76, 87, 115],
            false,
            |ctx, _events| {
                account_safety::settlement::initialize_limb_page(ctx, epoch, register, page_index)
            },
        )
    }
    pub fn accept_denominator_row(
        ctx: &mut Context<AcceptDenominatorRow>,
        epoch: u64,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [242, 184, 176, 46, 187, 169, 157, 208],
            false,
            |ctx, _events| account_safety::settlement::accept_denominator_row(ctx, epoch, revision),
        )
    }
    pub fn continue_settlement_denominator(
        ctx: &mut Context<ContinueSettlementDenominator>,
        epoch: u64,
        revision: u64,
        steps: u16,
        revisions: [u64; 3],
    ) -> Result<()> {
        let plan = account_safety::settlement::denominator_plan(&ctx.accounts.prepared)?;
        scoped_history::run_pages(
            ctx,
            [160, 108, 231, 235, 16, 93, 96, 125],
            plan,
            |ctx, _events| {
                account_safety::settlement::continue_denominator(
                    ctx, epoch, revision, steps, revisions,
                )
            },
        )
    }
    pub fn initialize_settlement_rates(
        ctx: &mut Context<InitializeSettlementRates>,
        epoch: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [111, 229, 223, 253, 40, 130, 51, 68],
            false,
            |ctx, _events| account_safety::settlement::initialize_rates(ctx, epoch),
        )
    }
    pub fn begin_settlement_rate_proposal(
        ctx: &mut Context<ManageSettlementProposal>,
        epoch: u64,
        revision: u64,
        factor: [u64; 5],
        lengths: [u64; 2],
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [82, 130, 146, 1, 163, 208, 99, 54],
            false,
            |ctx, _events| {
                account_safety::settlement::begin_rate_proposal(
                    ctx, epoch, revision, factor, lengths,
                )
            },
        )
    }
    pub fn reset_settlement_rate_proposal(
        ctx: &mut Context<ManageSettlementProposal>,
        epoch: u64,
        revision: u64,
        attempt: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [100, 110, 122, 83, 178, 173, 210, 0],
            false,
            |ctx, _events| {
                account_safety::settlement::reset_rate_proposal(ctx, epoch, revision, attempt)
            },
        )
    }
    pub fn upload_settlement_rate(
        ctx: &mut Context<UploadSettlementRate>,
        epoch: u64,
        revision: u64,
        attempt: u64,
        market: u8,
        offset: u64,
        words: Vec<u64>,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [115, 149, 43, 139, 252, 51, 233, 88],
            false,
            |ctx, _events| {
                account_safety::settlement::upload_rate(
                    ctx, epoch, revision, attempt, market, offset, words,
                )
            },
        )
    }
    pub fn prepare_settlement_rate_scratch(
        ctx: &mut Context<PrepareRateScratch>,
        epoch: u64,
        attempt: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [93, 27, 78, 189, 224, 59, 107, 168],
            false,
            |ctx, _events| account_safety::settlement::prepare_rate_scratch(ctx, epoch, attempt),
        )
    }
    pub fn accept_settlement_rate_row(
        ctx: &mut Context<AcceptSettlementRateRow>,
        epoch: u64,
        revision: u64,
        attempt: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [47, 66, 6, 235, 35, 105, 132, 193],
            false,
            |ctx, _events| {
                account_safety::settlement::accept_rate_row(ctx, epoch, revision, attempt)
            },
        )
    }
    pub fn continue_settlement_rates(
        ctx: &mut Context<ContinueSettlementRates>,
        epoch: u64,
        revision: u64,
        attempt: u64,
        steps: u16,
        revisions: [u64; 3],
    ) -> Result<()> {
        let plan =
            account_safety::settlement::rate_plan(&ctx.accounts.prepared, &ctx.accounts.rates)?;
        scoped_history::run_pages(
            ctx,
            [183, 223, 168, 83, 201, 143, 99, 138],
            plan,
            |ctx, _events| {
                account_safety::settlement::continue_rates(
                    ctx, epoch, revision, attempt, steps, revisions,
                )
            },
        )
    }
    pub fn initialize_settlement_plan(
        ctx: &mut Context<InitializeSettlementPlan>,
        epoch: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [142, 104, 12, 214, 212, 137, 32, 109],
            false,
            |ctx, _events| account_safety::settlement::initialize_plan(ctx, epoch),
        )
    }
    pub fn initialize_settlement_plan_page(
        ctx: &mut Context<InitializeSettlementPlanPage>,
        epoch: u64,
        register: u32,
        page_index: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [253, 190, 72, 214, 255, 210, 221, 29],
            false,
            |ctx, _events| {
                account_safety::settlement::initialize_plan_page(ctx, epoch, register, page_index)
            },
        )
    }
    pub fn accept_settlement_plan_row(
        ctx: &mut Context<AcceptSettlementPlanRow>,
        epoch: u64,
        revision: u64,
        ordinal: u64,
        attempt: u64,
        revisions: [u64; 3],
    ) -> Result<()> {
        let plan = account_safety::settlement::settlement_plan_row_pages(
            &ctx.accounts.prepared,
            &ctx.accounts.rates,
            &ctx.accounts.plan,
            ordinal,
        )?;
        scoped_history::run_pages(
            ctx,
            [114, 88, 4, 27, 204, 53, 88, 130],
            plan,
            |ctx, _events| {
                account_safety::settlement::accept_plan_row(
                    ctx, epoch, revision, ordinal, attempt, revisions,
                )
            },
        )
    }
    pub fn begin_settlement_plan_order(
        ctx: &mut Context<ManageSettlementPlan>,
        epoch: u64,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [204, 83, 186, 130, 114, 186, 221, 230],
            false,
            |ctx, _events| account_safety::settlement::begin_plan_order(ctx, epoch, revision),
        )
    }
    pub fn reset_settlement_plan_order(
        ctx: &mut Context<ManageSettlementPlan>,
        epoch: u64,
        revision: u64,
        attempt: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [238, 168, 72, 132, 250, 98, 141, 30],
            false,
            |ctx, _events| {
                account_safety::settlement::reset_plan_order(ctx, epoch, revision, attempt)
            },
        )
    }
    pub fn continue_settlement_plan(
        ctx: &mut Context<ContinueSettlementPlan>,
        epoch: u64,
        revision: u64,
        attempt: u64,
        steps: u16,
        revisions: [u64; 3],
    ) -> Result<()> {
        let plan = account_safety::settlement::settlement_plan_pages(
            &ctx.accounts.prepared,
            &ctx.accounts.rates,
            &ctx.accounts.plan,
        )?;
        scoped_history::run_pages(
            ctx,
            [244, 56, 133, 188, 70, 13, 9, 96],
            plan,
            |ctx, _events| {
                account_safety::settlement::continue_plan(
                    ctx, epoch, revision, attempt, steps, revisions,
                )
            },
        )
    }
    pub fn adopt_settlement_plan(
        ctx: &mut Context<AdoptSettlementPlan>,
        epoch: u64,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [84, 50, 146, 53, 66, 253, 189, 153],
            false,
            |ctx, events| account_safety::settlement::adopt_plan(ctx, events, epoch, revision),
        )
    }
    pub fn apply_settlement_margin(
        ctx: &mut Context<ApplySettlementMargin>,
        epoch: u64,
        revision: u64,
        ordinal: u64,
        revisions: [u64; 3],
    ) -> Result<()> {
        let pages = account_safety::settlement::settlement_application_pages(
            &ctx.accounts.prepared,
            &ctx.accounts.plan,
        )?;
        scoped_history::run_pages(
            ctx,
            [190, 16, 144, 204, 176, 176, 181, 193],
            pages,
            |ctx, events| {
                account_safety::settlement::apply_plan_margin(
                    ctx, events, epoch, revision, ordinal, revisions,
                )
            },
        )
    }
    pub fn complete_settlement_application(
        ctx: &mut Context<CompleteSettlementApplication>,
        epoch: u64,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [10, 70, 22, 12, 253, 92, 57, 0],
            false,
            |ctx, events| {
                account_safety::settlement::complete_application(ctx, events, epoch, revision)
            },
        )
    }
    pub fn reconcile_settlement_margin(
        ctx: &mut Context<ReconcileSettlementMargin>,
        epoch: u64,
        revision: u64,
        ordinal: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [99, 140, 60, 92, 22, 220, 254, 2],
            false,
            |ctx, events| {
                account_safety::settlement::reconcile_plan_margin(
                    ctx, events, epoch, revision, ordinal,
                )
            },
        )
    }
    pub fn complete_settlement_plan(
        ctx: &mut Context<CompleteSettlementPlan>,
        epoch: u64,
        revision: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [34, 107, 111, 142, 145, 94, 77, 189],
            false,
            |ctx, events| account_safety::settlement::complete_plan(ctx, events, epoch, revision),
        )
    }
    pub fn activate_liquidity(ctx: &mut Context<ActivateAccounts>) -> Result<()> {
        scoped_history::run(
            ctx,
            [246, 74, 124, 66, 126, 240, 164, 192],
            false,
            |ctx, events| account_trading::activation::activate_liquidity(ctx, events),
        )
    }
    pub fn advance_account_resolution(
        ctx: &mut Context<AdvanceAccountResolution>,
        epoch: u64,
        stage: u8,
        start: u16,
        length: u8,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [126, 218, 57, 229, 217, 138, 41, 255],
            stage == account_safety::resolution::APPLY,
            |ctx, events| {
                account_safety::resolution::advance(ctx, events, epoch, stage, start, length)
            },
        )
    }
    pub fn allocate_market_fees(
        ctx: &mut Context<AllocateMarketFees>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [238, 132, 46, 190, 60, 46, 250, 248],
            false,
            |ctx, events| account_cash::fees::allocate(ctx, events, market_index, amount),
        )
    }
    pub fn approve_liquidity(
        ctx: &mut Context<ControlLiquidity>,
        expected_authority: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [100, 203, 4, 69, 50, 23, 124, 228],
            false,
            |ctx, events| maker_liquidity::approve(ctx, events, expected_authority),
        )
    }
    pub fn check_account_resolution_order(
        ctx: &mut Context<AdvanceAccountResolution>,
        epoch: u64,
        start: u16,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [149, 102, 156, 38, 43, 158, 226, 4],
            false,
            |ctx, events| account_safety::resolution::check_order(ctx, events, epoch, start),
        )
    }
    pub fn check_account_retirement(
        ctx: &mut Context<CheckAccountRetirement>,
        start: u16,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [249, 193, 141, 17, 196, 101, 226, 246],
            false,
            |ctx, events| account_safety::resolution::retirement::check(ctx, events, start),
        )
    }
    pub fn check_market_backing(ctx: &mut Context<CheckMarketBacking>, start: u16) -> Result<()> {
        scoped_history::run(
            ctx,
            [66, 145, 239, 19, 111, 19, 186, 239],
            false,
            |ctx, events| account_cash::certificate::check(ctx, events, start),
        )
    }
    pub fn classify_market_surplus(
        ctx: &mut Context<ClassifyMarketSurplus>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [148, 185, 85, 189, 180, 126, 77, 91],
            false,
            |ctx, events| account_custody::classify_surplus(ctx, events, market_index, amount),
        )
    }
    pub fn collect_account_loss(
        ctx: &mut Context<ChangeAccountClaim>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [35, 140, 150, 47, 61, 125, 54, 188],
            false,
            |ctx, events| account_cash::claims::change(ctx, events, market_index, amount, false),
        )
    }
    pub fn configure_funding_publisher(
        ctx: &mut Context<ConfigureFundingPublisher>,
        expected_authority: u64,
        publisher: Address,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [209, 153, 177, 143, 74, 92, 77, 95],
            false,
            |ctx, events| {
                maker_liquidity::publisher::configure(ctx, events, expected_authority, publisher)
            },
        )
    }
    pub fn control_liquidity(
        ctx: &mut Context<ControlLiquidity>,
        expected_authority: u64,
        expected_control: u64,
        expected_shape: u64,
        action: maker_interface::canonical::CurveControl,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [236, 205, 59, 14, 74, 203, 241, 34],
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
    pub fn create_portfolio(ctx: &mut Context<CreatePortfolio>, index: u16) -> Result<()> {
        scoped_history::run(
            ctx,
            [54, 26, 137, 113, 59, 182, 53, 225],
            false,
            |ctx, events| account_custody::create_portfolio(ctx, events, index),
        )
    }
    pub fn deposit_account(ctx: &mut Context<AccountCash>, amount: u64) -> Result<()> {
        scoped_history::run(
            ctx,
            [177, 65, 65, 203, 1, 157, 104, 213],
            false,
            |ctx, events| account_custody::cash(ctx, events, amount, false),
        )
    }
    pub fn execute_liquidity_order(
        ctx: &mut Context<ExecuteLiquidityRoute>,
        args: LiquidityOrderExecution,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [128, 46, 100, 204, 183, 230, 53, 135],
            false,
            |ctx, events| maker_liquidity::routes::execute_order(ctx, events, args),
        )
    }
    pub fn execute_liquidity_route(
        ctx: &mut Context<ExecuteLiquidityRoute>,
        args: LiquidityRouteIntent,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [168, 103, 155, 184, 217, 71, 251, 209],
            false,
            |ctx, events| maker_liquidity::routes::execute(ctx, events, args),
        )
    }
    pub fn finalize_account_resolution_rates(
        ctx: &mut Context<ProposeAccountResolution>,
        epoch: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [240, 183, 132, 7, 94, 122, 26, 36],
            false,
            |ctx, events| account_safety::resolution::finalize(ctx, events, epoch),
        )
    }
    pub fn freeze_accounts(
        ctx: &mut Context<FreezeAccounts>,
        safety_epoch: u64,
        resolution_epoch: u64,
        emergency: bool,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [87, 63, 234, 112, 233, 23, 75, 13],
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
    pub fn initialize_account_resolution(
        ctx: &mut Context<InitializeAccountResolution>,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [183, 78, 104, 116, 183, 15, 47, 61],
            false,
            |ctx, events| account_safety::resolution::initialize(ctx, events),
        )
    }
    pub fn initialize_account_resolution_page(
        ctx: &mut Context<InitializeAccountResolutionPage>,
        page_index: u16,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [140, 24, 112, 109, 122, 218, 84, 200],
            false,
            |ctx, events| account_safety::resolution::initialize_page(ctx, events, page_index),
        )
    }
    pub fn initialize_account_retirement(
        ctx: &mut Context<InitializeAccountRetirement>,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [23, 14, 219, 16, 71, 23, 132, 51],
            false,
            |ctx, events| account_safety::resolution::retirement::initialize(ctx, events),
        )
    }
    pub fn initialize_funding_publisher(
        ctx: &mut Context<InitializeFundingPublisher>,
        publisher: Address,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [122, 218, 127, 187, 191, 112, 159, 32],
            false,
            |ctx, events| maker_liquidity::publisher::initialize(ctx, events, publisher),
        )
    }
    pub fn initialize_liquidity(ctx: &mut Context<InitializeLiquidity>) -> Result<()> {
        scoped_history::run(
            ctx,
            [27, 159, 247, 95, 173, 143, 67, 250],
            false,
            |ctx, events| maker_liquidity::initialize(ctx, events),
        )
    }
    pub fn initialize_liquidity_oracle(
        ctx: &mut Context<InitializeAccountOracle>,
        primary: Address,
        guard: Address,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [148, 248, 125, 23, 17, 194, 68, 202],
            false,
            |ctx, events| maker_liquidity::sampling::initialize(ctx, events, primary, guard),
        )
    }
    pub fn initialize_liquidity_venue(
        ctx: &mut Context<InitializeVenue>,
        domain: [u8; 32],
        fee_authority: Address,
        reserve_authority: Address,
        reserve_destination_owner: Address,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [239, 81, 3, 85, 25, 155, 68, 160],
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
    pub fn initialize_market(ctx: &mut Context<InitializeMarket>, index: u8) -> Result<()> {
        scoped_history::run(
            ctx,
            [35, 35, 189, 193, 155, 48, 170, 203],
            false,
            |ctx, events| account_custody::initialize_market(ctx, events, index),
        )
    }
    pub fn initialize_market_backing(
        ctx: &mut Context<InitializeMarketBacking>,
        market_index: u8,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [171, 150, 246, 208, 59, 111, 198, 53],
            false,
            |ctx, events| account_cash::certificate::initialize(ctx, events, market_index),
        )
    }
    pub fn initialize_venue_registry(ctx: &mut Context<InitializeVenueRegistry>) -> Result<()> {
        scoped_history::run(
            ctx,
            [65, 159, 220, 107, 114, 82, 191, 244],
            false,
            |ctx, events| account_custody::initialize_registry(ctx, events),
        )
    }
    pub fn liquidate_account(
        ctx: &mut Context<LiquidateAccount>,
        target_guard: account_trading::authority::AccountGuard,
        receiver_guard: account_trading::authority::AccountGuard,
        market_index: u8,
        lots: u64,
        price: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [39, 235, 197, 252, 216, 79, 212, 18],
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
    pub fn manage_account_order(
        ctx: &mut Context<ManageAccountOrder>,
        guard: account_trading::authority::AccountGuard,
        market_index: u8,
        operation: engine::routes::OrderAction,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [69, 25, 199, 184, 146, 122, 14, 218],
            false,
            |ctx, events| {
                account_trading::authority::manage(ctx, events, guard, market_index, operation)
            },
        )
    }
    pub fn net_account_claims(
        ctx: &mut Context<NetAccountClaims>,
        guard: account_trading::authority::AccountGuard,
        source_market: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [234, 97, 182, 215, 70, 97, 13, 87],
            false,
            |ctx, events| account_cash::claims::net(ctx, events, guard, source_market, amount),
        )
    }
    pub fn order_account_resolution(
        ctx: &mut Context<ProposeAccountResolution>,
        epoch: u64,
        orders: [Vec<u16>; 2],
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [54, 181, 74, 95, 94, 228, 178, 94],
            false,
            |ctx, events| account_safety::resolution::order(ctx, events, epoch, orders),
        )
    }
    pub fn pause_venue(ctx: &mut Context<PauseVenue>, paused: bool) -> Result<()> {
        scoped_history::run(
            ctx,
            [95, 78, 87, 119, 226, 152, 10, 227],
            false,
            |ctx, events| account_custody::pause(ctx, events, paused),
        )
    }
    pub fn pay_account_gain(
        ctx: &mut Context<ChangeAccountClaim>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [149, 199, 146, 251, 166, 53, 71, 27],
            false,
            |ctx, events| account_cash::claims::change(ctx, events, market_index, amount, true),
        )
    }
    pub fn propose_account_resolution(
        ctx: &mut Context<ProposeAccountResolution>,
        epoch: u64,
        evaluation: u8,
        proposal_hash: [u8; 32],
        offset: u16,
        bytes: Vec<u8>,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [5, 94, 130, 146, 21, 228, 47, 102],
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
    pub fn publish_funding_report(
        ctx: &mut Context<PublishFundingReport>,
        report: state::liquidity::FundingReport,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [32, 39, 131, 11, 127, 118, 35, 241],
            false,
            |ctx, events| maker_liquidity::publisher::publish(ctx, events, report),
        )
    }
    pub fn quarantine_liquidity(
        ctx: &mut Context<QuarantineLiquidity>,
        expected_authority: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [132, 146, 86, 13, 219, 126, 148, 43],
            false,
            |ctx, events| maker_liquidity::quarantine(ctx, events, expected_authority),
        )
    }
    pub fn reactivate_accounts(ctx: &mut Context<RecoverAccounts>, epoch: u64) -> Result<()> {
        scoped_history::run(
            ctx,
            [162, 89, 139, 133, 40, 94, 178, 191],
            false,
            |ctx, events| account_safety::resolution::reactivate(ctx, events, epoch),
        )
    }
    pub fn recover_accounts(
        ctx: &mut Context<RecoverAccounts>,
        epoch: u64,
        resume: bool,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [20, 29, 183, 179, 123, 39, 45, 195],
            false,
            |ctx, events| account_safety::resolution::recover(ctx, events, epoch, resume),
        )
    }
    pub fn register_liquidity(ctx: &mut Context<RegisterLiquidity>, instance: u8) -> Result<()> {
        scoped_history::run(
            ctx,
            [238, 192, 252, 155, 240, 56, 252, 251],
            false,
            |ctx, events| maker_liquidity::register(ctx, events, instance),
        )
    }
    pub fn register_margin(
        ctx: &mut Context<RegisterMargin>,
        subaccount_index: u16,
        mode: u8,
        isolated_market_index: u8,
        role: u8,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [156, 36, 155, 86, 98, 38, 140, 32],
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
    pub fn replenish_liquidity(
        ctx: &mut Context<ControlLiquidity>,
        expected_authority: u64,
        expected_depth: u64,
        sides: u8,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [164, 235, 145, 210, 171, 169, 231, 117],
            false,
            |ctx, events| {
                maker_liquidity::replenish(ctx, events, expected_authority, expected_depth, sides)
            },
        )
    }
    pub fn retire_accounts(ctx: &mut Context<RetireAccounts>, safety_epoch: u64) -> Result<()> {
        scoped_history::run(
            ctx,
            [205, 185, 237, 201, 15, 220, 100, 203],
            false,
            |ctx, events| account_safety::resolution::retirement::retire(ctx, events, safety_epoch),
        )
    }
    pub fn round_account_resolution(
        ctx: &mut Context<ProposeAccountResolution>,
        epoch: u64,
        start: u16,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [248, 104, 22, 65, 93, 7, 115, 112],
            false,
            |ctx, events| account_safety::resolution::round(ctx, events, epoch, start),
        )
    }
    pub fn seal_liquidity(ctx: &mut Context<SealLiquidity>) -> Result<()> {
        scoped_history::run(
            ctx,
            [31, 143, 152, 241, 90, 106, 88, 11],
            false,
            |ctx, events| maker_liquidity::seal(ctx, events),
        )
    }
    pub fn seed_market_insurance(
        ctx: &mut Context<SeedMarketInsurance>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [210, 218, 26, 12, 123, 193, 213, 209],
            false,
            |ctx, events| account_custody::seed_insurance(ctx, events, market_index, amount),
        )
    }
    pub fn set_account_delegate(
        ctx: &mut Context<SetAccountDelegate>,
        guard: account_trading::authority::AccountGuard,
        delegate: Address,
        expiry_slot: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [253, 87, 79, 111, 165, 50, 87, 251],
            false,
            |ctx, events| {
                account_trading::authority::delegate(ctx, events, guard, delegate, expiry_slot)
            },
        )
    }
    pub fn transfer_account_custody(
        ctx: &mut Context<TransferAccountCustody>,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [79, 118, 155, 110, 54, 143, 155, 72],
            false,
            |ctx, events| account_custody::transfer(ctx, events, amount),
        )
    }
    pub fn transfer_funded_account(
        ctx: &mut Context<TransferFundedAccount>,
        guard: account_trading::authority::AccountGuard,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [155, 89, 210, 42, 245, 176, 201, 73],
            false,
            |ctx, events| account_cash::cash::transfer(ctx, events, guard, amount),
        )
    }
    pub fn value_account_resolution(
        ctx: &mut Context<ValueAccountResolution>,
        epoch: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [104, 10, 208, 35, 140, 115, 13, 140],
            false,
            |ctx, events| account_safety::resolution::value_sources(ctx, events, epoch),
        )
    }
    pub fn withdraw_account_custody(ctx: &mut Context<AccountCash>, amount: u64) -> Result<()> {
        scoped_history::run(
            ctx,
            [211, 165, 24, 154, 201, 22, 195, 210],
            false,
            |ctx, events| account_custody::cash(ctx, events, amount, true),
        )
    }
    pub fn withdraw_funded_account(
        ctx: &mut Context<WithdrawFundedAccount>,
        guard: account_trading::authority::AccountGuard,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [192, 57, 45, 195, 49, 172, 22, 255],
            false,
            |ctx, events| account_cash::cash::withdraw(ctx, events, guard, amount),
        )
    }
    pub fn withdraw_market_fees(
        ctx: &mut Context<WithdrawMarketFees>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [196, 199, 207, 67, 231, 90, 235, 233],
            false,
            |ctx, events| account_cash::fees::withdraw(ctx, events, market_index, amount),
        )
    }
    pub fn withdraw_retired_reserve(
        ctx: &mut Context<WithdrawRetiredReserve>,
        market_index: u8,
        amount: u64,
    ) -> Result<()> {
        scoped_history::run(
            ctx,
            [143, 109, 72, 169, 117, 203, 249, 57],
            false,
            |ctx, events| {
                account_safety::resolution::retirement::withdraw(ctx, events, market_index, amount)
            },
        )
    }
}

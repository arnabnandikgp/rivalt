use anchor_lang::prelude::*;
#[cfg(any(test, feature = "devnet-test-profile"))]
mod pyth_core;
pub mod resolution;
pub use resolution::*;
pub mod risk;
pub use risk::*;
pub mod orders;
pub use orders::*;
pub mod custody;
pub use custody::*;
pub mod makers;
use maker_interface::QuoteResponse;
pub use makers::*;
pub mod routes;
pub use routes::*;
pub mod oracle;
pub use oracle::*;
pub mod settlement;
pub use settlement::*;

#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo");
#[cfg(feature = "devnet-test-profile")]
declare_id!("BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv");

#[cfg(all(feature = "local-test-profile", feature = "devnet-test-profile"))]
compile_error!("local and devnet financial profiles are mutually exclusive");

pub(crate) const fn financial_profile() -> bool {
    cfg!(any(
        feature = "local-test-profile",
        feature = "devnet-test-profile"
    ))
}

/// Financial paths require an explicit, separate engineering profile.
#[program]
pub mod clearing {
    use super::*;

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
        // A deterministic rejection lets RPC tests distinguish failed logs from committed state.
        require!(nonce != u64::MAX, ClearingError::ReservedNonce);
        let record = &mut ctx.accounts.record;
        record.owner = ctx.accounts.owner.key();
        record.nonce = nonce;
        record.signed_value = signed_value;
        record.optional_value = optional_value;
        record.choice = choice;
        record.bump = ctx.bumps.record;
        emit_cpi!(ProbeRecorded {
            schema_version: 1,
            owner: record.owner,
            record: record.key(),
            nonce,
            signed_value,
            optional_value,
            choice,
        });
        Ok(())
    }
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Probe<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + ProbeRecord::INIT_SPACE,
        seeds = [b"probe", owner.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub record: Account<'info, ProbeRecord>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ProbeRecord {
    pub owner: Pubkey,
    pub nonce: u64,
    pub signed_value: i128,
    pub optional_value: Option<u64>,
    pub choice: ProbeChoice,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum ProbeChoice {
    Empty,
    Number { value: u64 },
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

#[error_code]
pub enum ClearingError {
    #[msg("The maximum nonce is reserved for the local rejection probe")]
    ReservedNonce,
    #[msg("Custody arithmetic bound or overflow")]
    Arithmetic = 100,
    #[msg("Market is paused")]
    Paused,
    #[msg("Wrong authority")]
    Authority,
    #[msg("Expected classic SPL six-decimal collateral without freeze authority")]
    Mint,
    #[msg("Source and destination roles alias")]
    Alias,
    #[msg("Participant registry is full")]
    Capacity,
    #[msg("Amount must be positive")]
    Amount,
    #[msg("Actual vault is below allocated cash or cash totals disagree")]
    Reconciliation,
    #[msg("Financial state is outside the implemented phase profile")]
    Profile,
    #[msg("Domain identity must be nonzero")]
    Domain,
    #[msg("Maker program, config or capital binding mismatch")]
    MakerBinding,
    #[msg("Maker capital is unfunded or outside the implemented profile")]
    MakerCapital,
    #[msg("Maker or market epoch mismatch or expired quote")]
    MakerEpoch,
    #[msg("Maker registration is quarantined")]
    MakerQuarantined,
    #[msg("Maker deployment differs from approved ProgramData hash")]
    MakerUpgrade,
    #[msg("Maker quote exceeds price, size or capacity bounds")]
    MakerQuote,
    #[msg("Maker response producer, encoding or terms mismatch")]
    MakerResponse,
    #[msg("Route authority, quantity, lifetime, nonce or generation mismatch")]
    RouteIntent,
    #[msg("Synthetic observation is unavailable, stale or mismatched")]
    RiskObservation,
    #[msg("Route exceeds all-in, fee or execution bounds")]
    RouteLimit,
    #[msg("Post-fee health or exposure capacity fails")]
    RouteHealth,
    #[msg("Exit cohort is incomplete, insolvent, foreign or stale")]
    ExitCohort,
    #[msg("Financial action is bound to a different market sequence")]
    FinancialSequence,
    #[msg("Oracle source identity, verification or schema mismatch")]
    OracleSource,
    #[msg("Oracle action mode, sample timing or source policy rejects action")]
    OraclePolicy,
    #[msg("Stored order identity, version, prefix or state mismatch")]
    OrderState,
    #[msg("Order quantity, limits, lifetime, trigger or generation rejected")]
    OrderTerms,
    #[msg("No free bounded order/protective-group slot")]
    OrderSlots,
    #[msg("Current central index does not satisfy stored trigger")]
    OrderTrigger,
    #[msg("Liquidation receiver, funded fee or strict risk progress check failed")]
    Liquidation,
    #[msg("Resolution epoch, stage, cursor, cohort or accounting check failed")]
    Resolution,
}

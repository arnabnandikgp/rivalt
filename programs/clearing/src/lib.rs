use anchor_lang::prelude::*;
pub mod custody;
pub use custody::*;
pub mod makers;
use maker_interface::QuoteResponse;
pub use makers::*;
pub mod routes;
pub use routes::*;
pub mod settlement;
pub use settlement::*;

declare_id!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo");

/// Synthetic local routes require the explicit local-test-profile build feature.
#[program]
pub mod clearing {
    use super::*;

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
}

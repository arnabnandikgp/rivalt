use anchor_lang::prelude::*;
pub mod custody;
pub use custody::*;

declare_id!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo");

/// Profile 1 implements custody only. Trade/funding/order/default entrypoints are absent.
#[program]
pub mod clearing {
    use super::*;

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
    #[msg("Financial state is outside the implemented custody-only profile")]
    Profile,
    #[msg("Domain identity must be nonzero")]
    Domain,
}

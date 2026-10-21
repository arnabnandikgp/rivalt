// Shared implementation compiled into two distinct first-party program deployments.
use anchor_lang::prelude::*;
use maker_interface::{
    MakerState, QuoteRequest, QuoteResponse, MAX_EPOCH_SLOTS, MIN_EPOCH_SLOTS, VERSION,
};

#[account]
#[derive(InitSpace)]
pub struct MakerConfig {
    pub state: MakerState,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Stored identity only; clearing validates the funded Participant on registration.
    pub capital: UncheckedAccount<'info>,
    #[account(init, payer = owner, space = 8 + MakerConfig::INIT_SPACE,
        seeds = [b"maker", capital.key().as_ref()], bump)]
    pub config: Account<'info, MakerConfig>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Publish<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"maker", config.state.capital.as_ref()], bump = config.state.bump,
        constraint = config.state.owner == owner.key() @ MakerError::Authority)]
    pub config: Account<'info, MakerConfig>,
}
#[derive(Accounts)]
pub struct ReadQuote<'info> {
    #[account(seeds = [b"maker", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Account<'info, MakerConfig>,
}
fn expiry(slot: u64, duration: u64) -> Result<u64> {
    require!(
        (MIN_EPOCH_SLOTS..=MAX_EPOCH_SLOTS).contains(&duration),
        MakerError::Lifetime
    );
    slot.checked_add(duration)
        .ok_or(error!(MakerError::Lifetime))
}
fn initialize(
    ctx: Context<Initialize>,
    market: Pubkey,
    domain: [u8; 32],
    duration: u64,
) -> Result<()> {
    require!(
        market != Pubkey::default() && domain != [0; 32],
        MakerError::Binding
    );
    let slot = Clock::get()?.slot;
    ctx.accounts.config.state = MakerState {
        version: VERSION,
        maker_id: MAKER_ID,
        owner: ctx.accounts.owner.key(),
        market,
        capital: ctx.accounts.capital.key(),
        domain,
        quote_epoch: 1,
        start_slot: slot,
        expiry_slot: expiry(slot, duration)?,
        bump: ctx.bumps.config,
    };
    Ok(())
}
fn publish(ctx: Context<Publish>, duration: u64) -> Result<()> {
    let slot = Clock::get()?.slot;
    let state = &mut ctx.accounts.config.state;
    require!(slot >= state.expiry_slot, MakerError::Lifetime);
    state.quote_epoch = state
        .quote_epoch
        .checked_add(1)
        .ok_or(MakerError::Lifetime)?;
    state.start_slot = slot;
    state.expiry_slot = expiry(slot, duration)?;
    Ok(())
}
fn read_quote(ctx: Context<ReadQuote>, mut request: QuoteRequest) -> Result<QuoteResponse> {
    require!(
        ctx.accounts.config.state.maker_id == MAKER_ID,
        MakerError::Binding
    );
    // Hypothetical snapshots are allowed for indicative quoting. Only clearing's
    // later route instruction can authorize financial effects from a quote.
    request.slot = Clock::get()?.slot;
    maker_interface::quote(&ctx.accounts.config.state, &request)
        .map_err(|_| error!(MakerError::Quote))
}
#[error_code]
pub enum MakerError {
    #[msg("Wrong maker config authority")]
    Authority,
    #[msg("Invalid maker binding")]
    Binding,
    #[msg("Epoch lifetime invalid or previous epoch still active")]
    Lifetime,
    #[msg("Quote outside bounded strategy, capacity or lifetime")]
    Quote,
}

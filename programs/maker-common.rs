// Shared implementation compiled into two distinct first-party program deployments.
include!("maker-group.rs");
use anchor_lang::prelude::*;
use maker_interface::{
    MakerState, QuoteRequest, QuoteResponse, MAX_EPOCH_SLOTS, MIN_EPOCH_SLOTS, VERSION,
};

#[cfg(not(feature = "devnet-test-profile"))]
const CLEARING_ID: Pubkey = pubkey!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo");
#[cfg(feature = "devnet-test-profile")]
const CLEARING_ID: Pubkey = pubkey!("BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv");

#[account]
#[derive(InitSpace)]
pub struct MakerConfig {
    pub state: MakerState,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: initialize verifies clearing ownership and the signer-bound participant PDA.
    pub capital: UncheckedAccount<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + MakerConfig::INIT_SPACE,
        seeds = [b"maker", capital.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, MakerConfig>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Publish<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"maker", config.state.capital.as_ref()],
        bump = config.state.bump,
        constraint = config.state.owner == owner.key() @ MakerError::Authority,
    )]
    pub config: Account<'info, MakerConfig>,
}
#[derive(Accounts)]
pub struct ReadQuote<'info> {
    #[account(
        seeds = [b"maker", config.state.capital.as_ref()],
        bump = config.state.bump,
    )]
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
    context: Context<Initialize>,
    market: Pubkey,
    domain: [u8; 32],
    duration: u64,
) -> Result<()> {
    let owner = context.accounts.owner.key();
    let (capital, _) = Pubkey::find_program_address(
        &[b"participant", market.as_ref(), owner.as_ref()],
        &CLEARING_ID,
    );
    require_keys_eq!(
        context.accounts.capital.key(),
        capital,
        MakerError::Authority
    );
    require_keys_eq!(
        *context.accounts.capital.owner,
        CLEARING_ID,
        MakerError::Binding
    );
    require!(
        market != Pubkey::default() && domain != [0; 32],
        MakerError::Binding
    );
    let slot = Clock::get()?.slot;
    context.accounts.config.state = MakerState {
        version: VERSION,
        maker_id: MAKER_ID,
        owner: context.accounts.owner.key(),
        market,
        capital: context.accounts.capital.key(),
        domain,
        quote_epoch: 1,
        start_slot: slot,
        expiry_slot: expiry(slot, duration)?,
        bump: context.bumps.config,
    };
    Ok(())
}
fn publish(context: Context<Publish>, duration: u64) -> Result<()> {
    let slot = Clock::get()?.slot;
    let state = &mut context.accounts.config.state;
    require!(slot >= state.expiry_slot, MakerError::Lifetime);
    state.quote_epoch = state
        .quote_epoch
        .checked_add(1)
        .ok_or(MakerError::Lifetime)?;
    state.start_slot = slot;
    state.expiry_slot = expiry(slot, duration)?;
    Ok(())
}
fn read_quote(context: Context<ReadQuote>, mut request: QuoteRequest) -> Result<QuoteResponse> {
    require!(
        context.accounts.config.state.maker_id == MAKER_ID,
        MakerError::Binding
    );
    // Hypothetical snapshots are allowed for indicative quoting. Only clearing's
    // later route instruction can authorize financial effects from a quote.
    request.slot = Clock::get()?.slot;
    maker_interface::quote(&context.accounts.config.state, &request)
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

include!("maker-account.rs");
include!("maker-canonical.rs");

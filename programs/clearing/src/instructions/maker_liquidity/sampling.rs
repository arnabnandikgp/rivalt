//! Profile-4 source initialization and complete sealed-registry sampling. A
//! missing valid price degrades the observation; substituted identities reject.
use super::*;
use crate::instructions::account_trading::{self, oracle::InitializeAccountOracle};

#[event_cpi]
#[derive(Accounts)]
pub struct SampleLiquidityV4<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.key() @ ClearingError::Profile)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"liquidity-v4", market.key().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<Account<'info, LiquidityRegistryV4>>,
    /// CHECK: fixed source identity/owner/schema/sequence checked before policy.
    pub primary_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence checked before policy.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence checked before policy.
    pub guard_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence checked before policy.
    pub guard_collateral: UncheckedAccount<'info>,
    pub first_capital: Box<Account<'info, MarginAccountV3>>,
    pub first_registration: Box<Account<'info, MakerRegistrationV4>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: canonical read-only maker dependency authenticated before quoting.
    pub first_config: UncheckedAccount<'info>,
    /// CHECK: canonical read-only publication authenticated before quoting.
    pub first_price: UncheckedAccount<'info>,
    pub second_capital: Box<Account<'info, MarginAccountV3>>,
    pub second_registration: Box<Account<'info, MakerRegistrationV4>>,
    pub second_program: Program<'info>,
    pub second_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: canonical read-only maker dependency authenticated before quoting.
    pub second_config: UncheckedAccount<'info>,
    /// CHECK: canonical read-only publication authenticated before quoting.
    pub second_price: UncheckedAccount<'info>,
    pub third_capital: Box<Account<'info, MarginAccountV3>>,
    pub third_registration: Box<Account<'info, MakerRegistrationV4>>,
    pub third_program: Program<'info>,
    pub third_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: canonical read-only maker dependency authenticated before quoting.
    pub third_config: UncheckedAccount<'info>,
    /// CHECK: canonical read-only publication authenticated before quoting.
    pub third_price: UncheckedAccount<'info>,
}

pub fn initialize(
    ctx: Context<InitializeAccountOracle>,
    primary: Pubkey,
    guard: Pubkey,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    execution_profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
        &ctx.accounts.market,
    )?;
    account_trading::oracle::initialize_accounts(ctx, primary, guard)
}

/// Retired by D75: a caller cannot bypass the restricted publisher authority.
pub fn sample(_ctx: Context<SampleLiquidityV4>) -> Result<()> {
    err!(ClearingError::FundingReport)
}

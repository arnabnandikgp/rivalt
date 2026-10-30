use super::*;
use crate::instructions::account_trading::contexts::{
    __client_accounts_account_route_identity, __cpi_client_accounts_account_route_identity,
    AccountRouteIdentity, AccountRouteIdentityBumps,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteLiquidityRoute<'info> {
    pub identity: AccountRouteIdentity<'info>,
    #[account(seeds = [b"liquidity-v4", identity.market.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() && registry.market == identity.market.key() @ ClearingError::MakerBinding)]
    pub registry: Box<Account<'info, LiquidityRegistry>>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, MarginAccount>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, MakerRegistration>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: fixed read-only identity, ownership, code and quote verified before CPI.
    pub first_config: UncheckedAccount<'info>,
    /// CHECK: fixed read-only publication validated against current inventory/depth.
    pub first_price: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, MarginAccount>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, MakerRegistration>>>,
    pub second_program: Option<Program<'info>>,
    pub second_program_data: Option<Box<Account<'info, ProgramData>>>,
    /// CHECK: same fixed read-only checks as the first leg; all-or-none optional tuple.
    pub second_config: Option<UncheckedAccount<'info>>,
    /// CHECK: same fixed read-only checks as the first leg; no arbitrary remaining accounts.
    pub second_price: Option<UncheckedAccount<'info>>,
}

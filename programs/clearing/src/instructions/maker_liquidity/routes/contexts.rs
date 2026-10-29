use super::*;
use crate::instructions::account_trading::routes::{
    __client_accounts_account_route_identity_v3, __cpi_client_accounts_account_route_identity_v3,
    AccountRouteIdentityV3, AccountRouteIdentityV3Bumps,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteLiquidityRouteV4<'info> {
    pub identity: AccountRouteIdentityV3<'info>,
    #[account(seeds = [b"liquidity-v4", identity.market.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() && registry.market == identity.market.key() @ ClearingError::MakerBinding)]
    pub registry: Box<Account<'info, LiquidityRegistryV4>>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, MarginAccountV3>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, MakerRegistrationV4>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: fixed read-only identity, ownership, code and quote verified before CPI.
    pub first_config: UncheckedAccount<'info>,
    /// CHECK: fixed read-only publication validated against current inventory/depth.
    pub first_price: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, MarginAccountV3>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, MakerRegistrationV4>>>,
    pub second_program: Option<Program<'info>>,
    pub second_program_data: Option<Box<Account<'info, ProgramData>>>,
    /// CHECK: same fixed read-only checks as the first leg; all-or-none optional tuple.
    pub second_config: Option<UncheckedAccount<'info>>,
    /// CHECK: same fixed read-only checks as the first leg; no arbitrary remaining accounts.
    pub second_price: Option<UncheckedAccount<'info>>,
}

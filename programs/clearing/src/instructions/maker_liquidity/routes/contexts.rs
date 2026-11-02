use super::*;
use crate::instructions::account_trading::contexts::{
    __client_accounts_accountrouteidentity, __cpi_accounts_accountrouteidentity,
    AccountRouteIdentity, AccountRouteIdentityBumps,
};
use crate::{ProgramData, UpgradeableProgramAddress};

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteLiquidityRoute {
    pub identity: Nested<AccountRouteIdentity>,
    #[account(seeds = [b"liquidity-v4", identity.market.address().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.address().to_owned() && registry.market == identity.market.address().to_owned() @ ClearingError::MakerBinding)]
    pub registry: Box<BorshAccount<LiquidityRegistry>>,
    #[account(mut)]
    pub first_capital: Box<BorshAccount<MarginAccount>>,
    #[account(mut)]
    pub first_registration: Box<BorshAccount<MakerRegistration>>,
    /// CHECK: executable identity is bound to its loader metadata and approved hash.
    #[account(executable)]
    pub first_program: UncheckedAccount,
    pub first_program_data: Box<BorshAccount<ProgramData>>,
    /// CHECK: fixed read-only identity, ownership, code and quote verified before CPI.
    pub first_config: UncheckedAccount,
    /// CHECK: fixed read-only publication validated against current inventory/depth.
    pub first_price: UncheckedAccount,
    #[account(mut)]
    pub second_capital: Option<Box<BorshAccount<MarginAccount>>>,
    #[account(mut)]
    pub second_registration: Option<Box<BorshAccount<MakerRegistration>>>,
    /// CHECK: executable identity is bound to its loader metadata and approved hash.
    #[account(executable)]
    pub second_program: Option<UncheckedAccount>,
    pub second_program_data: Option<Box<BorshAccount<ProgramData>>>,
    /// CHECK: same fixed read-only checks as the first leg; all-or-none optional tuple.
    pub second_config: Option<UncheckedAccount>,
    /// CHECK: same fixed read-only checks as the first leg; no arbitrary remaining accounts.
    pub second_price: Option<UncheckedAccount>,
}

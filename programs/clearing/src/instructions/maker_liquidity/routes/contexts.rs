use super::*;
use crate::instructions::account_trading::contexts::{
    __client_accounts_accountrouteidentity, __cpi_accounts_accountrouteidentity,
    AccountRouteIdentity, AccountRouteIdentityBumps, ReadOnlyMarketIdentity, ReadOnlyMarketIdentityBumps,
    __client_accounts_readonlymarketidentity, __cpi_accounts_readonlymarketidentity, RouteIdentityView,
};
use crate::{ProgramData, UpgradeableProgramAddress};

// Both entry points authenticate the same maker and capital accounts. Their
// selected market access differs, which is reflected in their generated IDL.
macro_rules! route_context {
    ($name:ident, $identity:ident) => {
#[event_cpi]
#[derive(Accounts)]
pub struct $name {
    pub identity: Nested<$identity>,
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
        impl $name {
            pub(super) fn view(&mut self) -> RouteAccounts<'_> {
                RouteAccounts {
                    identity: self.identity.view(), registry: &self.registry,
                    first_capital: &mut self.first_capital, first_registration: &mut self.first_registration,
                    first_program: &self.first_program, first_program_data: &self.first_program_data,
                    first_config: &self.first_config, first_price: &self.first_price,
                    second_capital: &mut self.second_capital, second_registration: &mut self.second_registration,
                    second_program: &self.second_program, second_program_data: &self.second_program_data,
                    second_config: &self.second_config, second_price: &self.second_price,
                    event_authority: self.event_authority.account().clone(),
                }
            }
        }
    };
}
route_context!(ExecuteLiquidityRoute, AccountRouteIdentity);
route_context!(ExecuteMarketLane, ReadOnlyMarketIdentity);

pub(super) struct RouteAccounts<'a> {
    pub identity: RouteIdentityView<'a>,
    pub registry: &'a BorshAccount<LiquidityRegistry>,
    pub first_capital: &'a mut BorshAccount<MarginAccount>,
    pub first_registration: &'a mut BorshAccount<MakerRegistration>,
    pub first_program: &'a UncheckedAccount,
    pub first_program_data: &'a BorshAccount<ProgramData>,
    pub first_config: &'a UncheckedAccount,
    pub first_price: &'a UncheckedAccount,
    pub second_capital: &'a mut Option<Box<BorshAccount<MarginAccount>>>,
    pub second_registration: &'a mut Option<Box<BorshAccount<MakerRegistration>>>,
    pub second_program: &'a Option<UncheckedAccount>,
    pub second_program_data: &'a Option<Box<BorshAccount<ProgramData>>>,
    pub second_config: &'a Option<UncheckedAccount>,
    pub second_price: &'a Option<UncheckedAccount>,
    pub event_authority: AccountView,
}

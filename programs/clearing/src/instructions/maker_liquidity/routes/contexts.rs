use super::*;
use crate::instructions::account_trading::contexts::{
    __client_accounts_accountrouteidentity, __cpi_accounts_accountrouteidentity,
    AccountRouteIdentity, AccountRouteIdentityBumps, ReadOnlyMarketIdentity, ReadOnlyMarketIdentityBumps,
    ReadOnlyLedgerIdentity, ReadOnlyLedgerIdentityBumps, __client_accounts_readonlyledgeridentity, __cpi_accounts_readonlyledgeridentity,
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
                    additional: Vec::new(), second_capital: self.second_capital.as_deref_mut(), second_registration: self.second_registration.as_deref_mut(),
                    second_program: self.second_program.as_ref(), second_program_data: self.second_program_data.as_deref(),
                    second_config: self.second_config.as_ref(), second_price: self.second_price.as_ref(),
                    event_authority: self.event_authority.account().clone(),
                }
            }
        }
    };
}
route_context!(ExecuteLiquidityRoute, AccountRouteIdentity);
route_context!(ExecuteMarketLane, ReadOnlyMarketIdentity);
route_context!(ExecuteLedgerLane, ReadOnlyLedgerIdentity);

// Anchor flattens nested account names in its public IDL. Give each bundle
// distinct wire labels while sharing one implementation of the binding.
pub(super) struct MakerAccounts<'a> {
    capital: &'a mut BorshAccount<MarginAccount>,
    registration: &'a mut BorshAccount<MakerRegistration>,
    program: &'a UncheckedAccount,
    data: &'a BorshAccount<ProgramData>,
    config: &'a UncheckedAccount,
    price: &'a UncheckedAccount,
}
/// Additional signed candidate bundles use the same six ordered accounts as
/// each named candidate. Reject writable aliases before loading owned values.
pub(super) struct ExtraMaker {
    capital: Box<BorshAccount<MarginAccount>>,
    registration: BorshAccount<MakerRegistration>,
    program: UncheckedAccount,
    data: BorshAccount<ProgramData>,
    config: UncheckedAccount,
    price: UncheckedAccount,
}

impl ExtraMaker {
    pub(super) fn load(raw: &[AccountView], writable: &mut Vec<Address>) -> Result<Self> {
        let [capital,registration,program,data,config,price] = raw else { return Err(ClearingError::MakerBinding.into()); };
        for account in [capital,registration] {
            require!(account.is_writable() && !account.is_signer() && !account.executable() && account.owner()==&crate::ID
                && !writable.contains(account.address()), ClearingError::Alias);
            writable.push(*account.address());
        }
        require!(program.executable() && !data.executable() && !config.executable() && !price.executable()
            && [program,data,config,price].iter().all(|account| !account.is_signer() && !account.is_writable()),
            ClearingError::MakerBinding);
        // SAFETY: writable clearing-owned accounts are distinct from the named
        // accounts and previous bundles. The typed loaders check discriminators.
        unsafe {
            Ok(Self {
                capital:Box::new(BorshAccount::load_mut(capital.clone())?),
                registration:BorshAccount::load_mut(registration.clone())?,
                program:UncheckedAccount::load(program.clone())?,data:BorshAccount::load(data.clone())?,
                config:UncheckedAccount::load(config.clone())?,price:UncheckedAccount::load(price.clone())?,
            })
        }
    }

    pub(super) fn pricing(&self) -> pricing::View<'_> {
        pricing::View {capital:&self.capital,registration:&self.registration,program:&self.program,
            data:&self.data,config:&self.config,price:&self.price}
    }
    fn bundle(&mut self) -> MakerAccounts<'_> {
        MakerAccounts {capital:&mut self.capital,registration:&mut self.registration,program:&self.program,
            data:&self.data,config:&self.config,price:&self.price}
    }
    pub(super) fn persist(&mut self) -> Result<()> {
        self.capital.exit()?;
        self.registration.exit()
    }
}
macro_rules! maker_bundle {
    ($name:ident, $capital:ident, $registration:ident, $program:ident, $data:ident, $config:ident, $price:ident) => {
        #[derive(Accounts)]
        pub struct $name {
            #[account(mut)]
            pub $capital: Box<BorshAccount<MarginAccount>>,
            #[account(mut)]
            pub $registration: Box<BorshAccount<MakerRegistration>>,
            /// CHECK: the sealed registration binds the executable and its approved code.
            #[account(executable)]
            pub $program: UncheckedAccount,
            pub $data: Box<BorshAccount<ProgramData>>,
            /// CHECK: clearing authenticates the maker-owned curve, price and current authority.
            pub $config: UncheckedAccount,
            /// CHECK: a fixed read-only maker PDA bound to the curve.
            pub $price: UncheckedAccount,
        }
        impl $name {
            pub(super) fn pricing(&self) -> pricing::View<'_> {
                pricing::View { capital: &self.$capital, registration: &self.$registration,
                    program: &self.$program, data: &self.$data, config: &self.$config, price: &self.$price }
            }
            fn bundle(&mut self) -> MakerAccounts<'_> {
                MakerAccounts {capital: &mut self.$capital, registration: &mut self.$registration,
                    program: &self.$program, data: &self.$data, config: &self.$config, price: &self.$price}
            }
            pub(crate) fn visit_maker(&mut self, scope: &mut crate::scoped_history::Scope, index: usize) -> Result<()> {
                let (capital, registration) = scope.maker_access(index)?;
                scope.account(&mut self.$capital, capital)?;
                scope.account(&mut self.$registration, registration)
            }
        }
    };
}
maker_bundle!(RouteMakerZero, zero_capital, zero_registration, zero_program, zero_program_data, zero_config, zero_price);
maker_bundle!(RouteMakerOne, one_capital, one_registration, one_program, one_program_data, one_config, one_price);
maker_bundle!(RouteMakerTwo, two_capital, two_registration, two_program, two_program_data, two_config, two_price);

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteBestRoute {
    pub identity: Nested<AccountRouteIdentity>,
    #[account(seeds = [b"liquidity-v4", identity.market.address().as_ref()], bump = registry.bump,
        constraint = registry.venue == *identity.venue.address() && registry.market == *identity.market.address() @ ClearingError::MakerBinding)]
    pub registry: Box<BorshAccount<LiquidityRegistry>>,
    pub candidate_zero: Nested<RouteMakerZero>,
    pub candidate_one: Nested<RouteMakerOne>,
    pub candidate_two: Nested<RouteMakerTwo>,
}

impl ExecuteBestRoute {
    pub(super) fn selected<'a>(&'a mut self, extra: &'a mut [ExtraMaker], lots: &[u64], lane_slot: Option<usize>)
        -> Result<(RouteAccounts<'a>, Option<&'a mut BorshAccount<MakerRegistration>>)> {
        let mut lane = None;
        let mut makers = Vec::with_capacity(lots.len());
        for (index, maker) in [self.candidate_zero.bundle(), self.candidate_one.bundle(),
            self.candidate_two.bundle()].into_iter().chain(extra.iter_mut().map(ExtraMaker::bundle)).enumerate() {
            if lots[index] > 0 { makers.push(maker); }
            else if lane_slot == Some(index) { lane = Some(maker.registration); }
        }
        let mut makers = makers.into_iter();
        let first = makers.next().ok_or(ClearingError::RouteIntent)?;
        let second = makers.next();
        let additional = makers.map(|maker| (maker.capital,maker.registration)).collect();
        let mut accounts = RouteAccounts {
            identity: self.identity.view(), registry: &self.registry,
            additional, first_capital: first.capital, first_registration: first.registration,
            first_program: first.program, first_program_data: first.data,
            first_config: first.config, first_price: first.price,
            second_capital: None, second_registration: None, second_program: None,
            second_program_data: None, second_config: None, second_price: None,
            event_authority: self.event_authority.account().clone(),
        };
        if let Some(maker) = second {
            accounts.second_capital = Some(maker.capital);
            accounts.second_registration = Some(maker.registration);
            accounts.second_program = Some(maker.program);
            accounts.second_program_data = Some(maker.data);
            accounts.second_config = Some(maker.config);
            accounts.second_price = Some(maker.price);
        }
        Ok((accounts, lane))
    }
}

pub(super) struct RouteAccounts<'a> {
    pub additional: Vec<(&'a mut BorshAccount<MarginAccount>, &'a mut BorshAccount<MakerRegistration>)>,
    pub identity: RouteIdentityView<'a>,
    pub registry: &'a BorshAccount<LiquidityRegistry>,
    pub first_capital: &'a mut BorshAccount<MarginAccount>,
    pub first_registration: &'a mut BorshAccount<MakerRegistration>,
    pub first_program: &'a UncheckedAccount,
    pub first_program_data: &'a BorshAccount<ProgramData>,
    pub first_config: &'a UncheckedAccount,
    pub first_price: &'a UncheckedAccount,
    pub second_capital: Option<&'a mut BorshAccount<MarginAccount>>,
    pub second_registration: Option<&'a mut BorshAccount<MakerRegistration>>,
    pub second_program: Option<&'a UncheckedAccount>,
    pub second_program_data: Option<&'a BorshAccount<ProgramData>>,
    pub second_config: Option<&'a UncheckedAccount>,
    pub second_price: Option<&'a UncheckedAccount>,
    pub event_authority: AccountView,
}

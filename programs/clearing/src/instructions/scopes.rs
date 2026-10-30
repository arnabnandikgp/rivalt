//! Explicit declared-account coverage for each public clearing context.
//! Keep this table synchronized with Anchor declarations; the coverage test
//! compares nested/optional fields and access, independently of message flags.
use super::*;
use crate::scoped_history::{Access, Scope, ScopedContext};
use anchor_lang::prelude::*;

macro_rules! context {
    ($context:ident, $($venue:ident).+, $($authority:ident).+;
        [$($($field:ident).+ : $access:ident),* $(,)?];
        [$($($optional:ident).+ : $optional_access:ident),* $(,)?]) => {
        impl<'info> ScopedContext<'info> for $context<'info> {
            fn visit(&mut self, scope: &mut Scope) -> Result<()> {
                $(scope.account(&mut self.$($field).+, Access::$access)?;)*
                $(if let Some(account) = self.$($optional).+.as_deref_mut() {
                    scope.account(account, Access::$optional_access)?;
                })*
                Ok(())
            }
            fn venue(&self) -> (Pubkey, [u8; 32]) {
                (self.$($venue).+.key(), self.$($venue).+.domain)
            }
            fn event_authority(&self) -> AccountInfo<'info> {
                self.$($authority).+.to_account_info()
            }
        }
    };
}

context!(AccountCash, venue, event_authority;
    [
        venue: Read,
        custody: Write,
        safety: Read,
        btc_ledger: Read,
        eth_ledger: Read,
        margin: Write,
    ];
    []);

context!(ActivateAccounts, qualification.venue, qualification.event_authority;
    [
        qualification.venue: Read,
        qualification.custody: Read,
        qualification.safety: Write,
        qualification.btc: Write,
        qualification.eth: Write,
        qualification.btc_ledger: Read,
        qualification.eth_ledger: Read,
        resolution: Read,
    ];
    []);

context!(AdvanceAccountResolution, identity.venue, event_authority;
    [
        identity.venue: Write,
        identity.custody: Write,
        identity.safety: Write,
        identity.btc: Write,
        identity.eth: Write,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        registry: Read,
        resolution: Write,
        work: Write,
        page: Write,
    ];
    []);

context!(ChangeAccountClaim, identity.venue, event_authority;
    [
        identity.venue: Read,
        identity.custody: Write,
        identity.safety: Read,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        margin: Write,
        registry: Read,
    ];
    [identity.btc: Write, identity.eth: Write, certificate: Read]);

context!(CheckAccountRetirement, identity.venue, event_authority;
    [
        identity.venue: Write,
        identity.custody: Write,
        identity.safety: Write,
        identity.btc: Write,
        identity.eth: Write,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        registry: Read,
        certificate: Write,
    ];
    []);

context!(CheckMarketBacking, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        registry: Read,
        btc: Read,
        eth: Read,
        ledger: Read,
        certificate: Write,
    ];
    []);

context!(ClassifyMarketSurplus, venue, event_authority;
    [
        venue: Read,
        custody: Write,
        safety: Read,
        btc_ledger: Write,
        eth_ledger: Write,
    ];
    []);

context!(ConfigureFundingPublisher, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        market: Write,
        configuration: Write,
    ];
    []);

context!(ControlLiquidity, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        market: Write,
        registration: Write,
        capital: Read,
    ];
    []);

context!(CreatePortfolio, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        portfolio: Create,
    ];
    []);

context!(ExecuteLiquidityRoute, identity.venue, event_authority;
    [
        identity.venue: Read,
        identity.custody: Write,
        identity.safety: Read,
        identity.market: Write,
        identity.ledger: Write,
        identity.other_ledger: Read,
        identity.trader: Write,
        registry: Read,
        first_capital: Write,
        first_registration: Write,
    ];
    [identity.other_market: Write, second_capital: Write, second_registration: Write]);

context!(FreezeAccounts, identity.venue, event_authority;
    [
        identity.venue: Write,
        identity.custody: Write,
        identity.safety: Write,
        identity.btc: Write,
        identity.eth: Write,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        registry: Read,
        resolution: Write,
        work: Write,
        target: Read,
    ];
    []);

context!(InitializeAccountOracle, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        market: Write,
    ];
    []);

context!(InitializeAccountResolution, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        resolution: Create,
        work: Create,
    ];
    []);

context!(InitializeAccountResolutionPage, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        resolution: Write,
        page: Create,
    ];
    []);

context!(InitializeAccountRetirement, venue, event_authority;
    [
        venue: Read,
        safety: Read,
        certificate: Create,
    ];
    []);

context!(InitializeFundingPublisher, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        market: Write,
        registry: Read,
        configuration: Create,
    ];
    []);

context!(InitializeLiquidity, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        market: Read,
        safety: Read,
        registry: Create,
    ];
    []);

context!(InitializeMarket, venue, event_authority;
    [
        venue: Write,
        custody: Read,
        safety: Read,
        market: Create,
        ledger: Create,
    ];
    []);

context!(InitializeMarketBacking, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        certificate: Create,
    ];
    []);

context!(InitializeVenue, venue, event_authority;
    [
        venue: Create,
        custody: Create,
        safety: Create,
    ];
    []);

context!(InitializeVenueRegistry, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        registry: Create,
    ];
    []);

context!(LiquidateAccount, identity.venue, event_authority;
    [
        identity.venue: Read,
        identity.custody: Write,
        identity.safety: Read,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        target: Write,
        receiver: Write,
    ];
    [identity.btc: Write, identity.eth: Write]);

context!(ManageAccountOrder, venue, event_authority;
    [
        venue: Read,
        custody: Write,
        safety: Read,
        margin: Write,
    ];
    [btc: Write, eth: Write]);

context!(ManageMarketFees, identity.venue, event_authority;
    [
        identity.venue: Read,
        identity.custody: Write,
        identity.safety: Read,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
    ];
    [identity.btc: Write, identity.eth: Write]);

context!(NetAccountClaims, identity.venue, event_authority;
    [
        identity.venue: Read,
        identity.custody: Write,
        identity.safety: Read,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        margin: Write,
        registry: Read,
        certificate: Read,
    ];
    [identity.btc: Write, identity.eth: Write]);

context!(PauseVenue, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Write,
        btc_ledger: Read,
        eth_ledger: Read,
    ];
    []);

context!(ProposeAccountResolution, identity.venue, event_authority;
    [
        identity.venue: Write,
        identity.custody: Write,
        identity.safety: Write,
        identity.btc: Write,
        identity.eth: Write,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        registry: Read,
        resolution: Write,
        work: Write,
    ];
    []);

context!(PublishFundingReport, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        market: Write,
        configuration: Write,
    ];
    []);

context!(QuarantineLiquidity, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        market: Write,
        registration: Write,
        capital: Read,
    ];
    []);

context!(RecoverAccounts, identity.venue, event_authority;
    [
        identity.venue: Write,
        identity.custody: Write,
        identity.safety: Write,
        identity.btc: Write,
        identity.eth: Write,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        registry: Read,
        resolution: Write,
    ];
    []);

context!(RegisterLiquidity, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        market: Read,
        registry: Write,
        capital: Read,
        registration: Create,
        capital_binding: Create,
    ];
    []);

context!(RegisterMargin, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        registry: Write,
        portfolio: Write,
        margin: Create,
    ];
    []);

context!(RetireAccounts, identity.venue, event_authority;
    [
        identity.venue: Write,
        identity.custody: Write,
        identity.safety: Write,
        identity.btc: Write,
        identity.eth: Write,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        registry: Read,
    ];
    [certificate: Read, resolution: Write]);

context!(SealLiquidity, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        market: Read,
        safety: Read,
        registry: Write,
        first: Read,
        second: Read,
        third: Read,
    ];
    []);

context!(SeedMarketInsurance, venue, event_authority;
    [
        venue: Read,
        custody: Write,
        safety: Read,
        btc_ledger: Write,
        eth_ledger: Write,
    ];
    []);

context!(SetAccountDelegate, venue, event_authority;
    [
        venue: Read,
        custody: Write,
        safety: Read,
        margin: Write,
    ];
    []);

context!(TransferAccountCustody, venue, event_authority;
    [
        venue: Read,
        custody: Read,
        safety: Read,
        btc_ledger: Read,
        eth_ledger: Read,
        donor: Write,
        recipient: Write,
    ];
    []);

context!(TransferFundedAccount, identity.venue, event_authority;
    [
        identity.venue: Read,
        identity.custody: Write,
        identity.safety: Read,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        donor: Write,
        recipient: Write,
    ];
    [identity.btc: Write, identity.eth: Write]);

context!(ValueAccountResolution, identity.venue, event_authority;
    [
        identity.venue: Write,
        identity.custody: Write,
        identity.safety: Write,
        identity.btc: Write,
        identity.eth: Write,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        registry: Read,
        resolution: Write,
    ];
    []);

context!(WithdrawFundedAccount, identity.venue, event_authority;
    [
        identity.venue: Read,
        identity.custody: Write,
        identity.safety: Read,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
        margin: Write,
    ];
    [identity.btc: Write, identity.eth: Write]);

context!(WithdrawRetiredReserve, identity.venue, event_authority;
    [
        identity.venue: Read,
        identity.custody: Write,
        identity.safety: Read,
        identity.btc_ledger: Write,
        identity.eth_ledger: Write,
    ];
    [identity.btc: Write, identity.eth: Write]);

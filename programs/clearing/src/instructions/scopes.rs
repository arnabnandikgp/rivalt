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
        impl ScopedContext for $context {
            fn visit(&mut self, scope: &mut Scope) -> Result<()> {
                $(scope.account(&mut self.$($field).+, Access::$access)?;)*
                $(if let Some(account) = self.$($optional).+.as_deref_mut() {
                    scope.account(account, Access::$optional_access)?;
                })*
                Ok(())
            }
            fn venue(&self) -> (Address, [u8; 32]) {
                (self.$($venue).+.address().to_owned(), self.$($venue).+.domain)
            }
            fn event_authority(&self) -> AccountView {
                self.$($authority).+.account().clone()
            }
        }
    };
}

impl ScopedContext for FundMemberPage {
    fn visit(&mut self, scope: &mut Scope) -> Result<()> {
        scope.account(&mut self.venue, Access::Read)?;
        scope.account(&mut self.safety, Access::Read)?;
        scope.created_raw::<crate::state::accounts::MemberPage>(&mut self.allocation.account().clone())?;
        scope.account(&mut self.receipt, Access::Create)
    }
    fn venue(&self) -> (Address, [u8; 32]) { (*self.venue.address(), self.venue.domain) }
    fn event_authority(&self) -> AccountView { self.event_authority.account().clone() }
}
impl ScopedContext for FundMemberIndex {
    fn visit(&mut self, scope: &mut Scope) -> Result<()> {
        scope.account(&mut self.venue, Access::Read)?;
        scope.account(&mut self.safety, Access::Read)?;
        scope.created_raw::<crate::state::accounts::MemberIndexNode>(&mut self.allocation.account().clone())?;
        scope.account(&mut self.receipt, Access::Create)
    }
    fn venue(&self) -> (Address, [u8; 32]) { (*self.venue.address(), self.venue.domain) }
    fn event_authority(&self) -> AccountView { self.event_authority.account().clone() }
}
context!(InitializeRecoveryStorage, venue, event_authority;
[venue: Read, safety: Read, storage: Create]; []);
context!(ConfigureRecoveryStorage, venue, event_authority;
[venue: Read, safety: Read, storage: Write]; []);

impl ScopedContext for FundRecoveryAllocation {
    fn visit(&mut self, scope: &mut Scope) -> Result<()> {
        scope.account(&mut self.venue, Access::Read)?;
        scope.account(&mut self.safety, Access::Read)?;
        scope.account(&mut self.storage, Access::Read)?;
        let state = self.storage.model();
        let allocation = state.expected(state.generation, state.next_allocation)
            .map_err(|_| crate::ClearingError::Resolution)?;
        let account = &mut self.allocation.account().clone();
        use financial_core::clearing::scalable::recovery_storage::Allocation;
        use crate::state::accounts::*;
        match allocation {
            Allocation::Prepared => scope.created_raw::<PreparedSettlement>(account)?,
            Allocation::Rates => scope.created_raw::<SettlementRates>(account)?,
            Allocation::Plan => scope.created_raw::<SettlementPlan>(account)?,
            Allocation::FrozenRows { .. } => scope.created_raw::<FrozenMarginPage>(account)?,
            Allocation::Limbs { .. } => scope.created_raw::<SettlementLimbPage>(account)?,
        }
        scope.account(&mut self.receipt, Access::Create)
    }
    fn venue(&self) -> (Address, [u8; 32]) { (*self.venue.address(), self.venue.domain) }
    fn event_authority(&self) -> AccountView { self.event_authority.account().clone() }
}
impl ScopedContext for VerifyRecoveryAllocation {
    fn visit(&mut self, scope: &mut Scope) -> Result<()> {
        scope.account(&mut self.venue, Access::Read)?;
        scope.account(&mut self.safety, Access::Read)?;
        scope.account(&mut self.storage, Access::Write)?;
        let account = &mut self.allocation.account().clone();
        let discriminator = account.try_borrow()?.get(..8).ok_or(crate::ClearingError::Resolution)?.to_vec();
        use crate::state::accounts::*;
        if discriminator == PreparedSettlement::DISCRIMINATOR { scope.raw::<PreparedSettlement>(account, Access::Read)?; }
        else if discriminator == SettlementRates::DISCRIMINATOR { scope.raw::<SettlementRates>(account, Access::Read)?; }
        else if discriminator == SettlementPlan::DISCRIMINATOR { scope.raw::<SettlementPlan>(account, Access::Read)?; }
        else if discriminator == FrozenMarginPage::DISCRIMINATOR { scope.raw::<FrozenMarginPage>(account, Access::Read)?; }
        else if discriminator == SettlementLimbPage::DISCRIMINATOR { scope.raw::<SettlementLimbPage>(account, Access::Read)?; }
        else { return Err(crate::ClearingError::Resolution.into()); }
        scope.account(&mut self.receipt, Access::Read)
    }
    fn venue(&self) -> (Address, [u8; 32]) { (*self.venue.address(), self.venue.domain) }
    fn event_authority(&self) -> AccountView { self.event_authority.account().clone() }
}

context!(AccountCash, venue, event_authority;
[
    venue: Read,
    custody: Write,
    safety: Read,
    margin: Write,
];
[
    btc_ledger: Write,
    eth_ledger: Write,
]);

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
    registry: Read,
    storage: Read,
];
[
]);



context!(AllocateMarketFees, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    identity.ledger: Write,
];
[
]);

context!(ChangeAccountClaim, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    margin: Write,
    registry: Read,
];
[
    identity.btc: Write,
    identity.eth: Write,
    btc_ledger: Write,
    eth_ledger: Write,
    certificate: Read,
]);

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
[
]);

context!(CheckMarketBacking, venue, event_authority;
[
    venue: Read,
    safety: Read,
    registry: Read,
    btc: Read,
    eth: Read,
    ledger: Read,
    certificate: Write,
];
[
]);

context!(ClassifyMarketSurplus, venue, event_authority;
[
    venue: Read,
    custody: Write,
    safety: Read,
    ledger: Write,
];
[
]);

context!(ConfigureFundingPublisher, venue, event_authority;
[
    venue: Read,
    safety: Read,
    market: Write,
    configuration: Write,
];
[
]);

context!(ControlLiquidity, venue, event_authority;
[
    venue: Read,
    safety: Read,
    market: Write,
    registration: Write,
    capital: Read,
];
[
]);

context!(CreatePortfolio, venue, event_authority;
[
    venue: Read,
    custody: Read,
    safety: Read,
    portfolio: Create,
];
[
]);

context!(ExecuteLiquidityRoute, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    identity.market: Write,
    identity.ledger: Write,
    identity.trader: Write,
    registry: Read,
    first_capital: Write,
    first_registration: Write,
];
[
    identity.other_market: Write,
    identity.other_ledger: Write,
    second_capital: Write,
    second_registration: Write,
]);

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
    target: Read,
    members: Read,
    storage: Write,
];
[
]);

context!(InitializeAccountOracle, venue, event_authority;
[
    venue: Read,
    custody: Read,
    safety: Read,
    market: Write,
];
[
]);

context!(InitializeAccountResolution, venue, event_authority;
[
    venue: Read,
    custody: Read,
    safety: Read,
    resolution: Create,
];
[
]);



context!(InitializeAccountRetirement, venue, event_authority;
[
    venue: Read,
    safety: Read,
    certificate: Create,
];
[
]);

context!(InitializeFundingPublisher, venue, event_authority;
[
    venue: Read,
    safety: Read,
    market: Write,
    registry: Read,
    configuration: Create,
];
[
]);

context!(InitializeLiquidity, venue, event_authority;
[
    venue: Read,
    market: Read,
    safety: Read,
    registry: Create,
];
[
]);

context!(InitializeMarket, venue, event_authority;
[
    venue: Write,
    custody: Read,
    safety: Read,
    market: Create,
    ledger: Create,
];
[
]);

context!(InitializeMarketBacking, venue, event_authority;
[
    venue: Read,
    safety: Read,
    certificate: Create,
];
[
]);

context!(InitializeVenue, venue, event_authority;
[
    venue: Create,
    custody: Create,
    safety: Create,
];
[
]);

context!(InitializeVenueRegistry, venue, event_authority;
[
    venue: Read,
    custody: Read,
    safety: Read,
    registry: Create,
];
[
]);

context!(LiquidateAccount, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    target: Write,
    receiver: Write,
];
[
    identity.btc: Write,
    identity.eth: Write,
    btc_ledger: Write,
    eth_ledger: Write,
]);

context!(ManageAccountOrder, venue, event_authority;
[
    venue: Read,
    safety: Read,
    margin: Write,
];
[
    btc: Write,
    eth: Write,
]);

context!(NetAccountClaims, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    btc_ledger: Write,
    eth_ledger: Write,
    margin: Write,
    registry: Read,
    certificate: Read,
];
[
    identity.btc: Write,
    identity.eth: Write,
]);

context!(PauseVenue, venue, event_authority;
[
    venue: Read,
    custody: Read,
    safety: Write,
    btc_ledger: Read,
    eth_ledger: Read,
];
[
]);



context!(PublishFundingReport, venue, event_authority;
[
    venue: Read,
    safety: Read,
    market: Write,
    configuration: Write,
];
[
]);

context!(QuarantineLiquidity, venue, event_authority;
[
    venue: Read,
    safety: Read,
    market: Write,
    registration: Write,
    capital: Read,
];
[
]);

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
[
]);

context!(RegisterLiquidity, venue, event_authority;
[
    venue: Read,
    safety: Read,
    market: Read,
    registry: Write,
    capital: Read,
    registration: Create,
    capital_binding: Create,
];
[
]);

context!(RegisterMargin, venue, event_authority;
[
    venue: Read,
    custody: Read,
    safety: Read,
    registry: Write,
    portfolio: Write,
    margin: Create,
    members: Write,
];
[
]);

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
[
    certificate: Read,
    resolution: Write,
]);

context!(SealLiquidity, venue, event_authority;
[
    venue: Read,
    market: Read,
    safety: Read,
    registry: Write,
    first: Read,
    second: Read,
    third: Read,
];
[
]);

context!(SeedMarketInsurance, venue, event_authority;
[
    venue: Read,
    custody: Write,
    safety: Read,
    ledger: Write,
];
[
]);

context!(SetAccountDelegate, venue, event_authority;
[
    venue: Read,
    safety: Read,
    margin: Write,
];
[
]);

context!(TransferAccountCustody, venue, event_authority;
[
    venue: Read,
    safety: Read,
    donor: Write,
    recipient: Write,
];
[
]);

context!(TransferFundedAccount, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    donor: Write,
    recipient: Write,
];
[
    identity.btc: Write,
    identity.eth: Write,
    btc_ledger: Write,
    eth_ledger: Write,
]);

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
[
]);

context!(WithdrawFundedAccount, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    custody: Write,
    margin: Write,
];
[
    identity.btc: Write,
    identity.eth: Write,
    btc_ledger: Write,
    eth_ledger: Write,
]);

context!(WithdrawMarketFees, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    identity.ledger: Write,
    identity.custody: Write,
];
[
]);

context!(WithdrawRetiredReserve, identity.venue, event_authority;
[
    identity.venue: Read,
    identity.safety: Read,
    identity.ledger: Write,
    identity.custody: Write,
];
[
]);

context!(InitializePreparedSettlement, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Write,
];
[]);





context!(InitializeFrozenMarginPage, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    page: Write,
];
[]);

context!(ValuePreparedMember, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Write,
    members: Read,
    margin: Read,
    page: Write,
];
[]);

impl ScopedContext for AdvancePreparedMembership {
    fn visit(&mut self, scope: &mut Scope) -> Result<()> {
        scope.account(&mut self.source.venue, Access::Read)?;
        scope.account(&mut self.source.custody, Access::Read)?;
        scope.account(&mut self.source.safety, Access::Read)?;
        scope.account(&mut self.source.registry, Access::Read)?;
        scope.account(&mut self.source.storage, Access::Read)?;
        scope.account(&mut self.source.resolution, Access::Read)?;
        scope.account(&mut self.source.btc, Access::Read)?;
        scope.account(&mut self.source.eth, Access::Read)?;
        scope.account(&mut self.source.btc_ledger, Access::Read)?;
        scope.account(&mut self.source.eth_ledger, Access::Read)?;
        scope.account(&mut self.prepared, Access::Write)?;
        // Use the actual immutable discriminator on both visits: the handler
        // advances its cursor, so its next request may have a different kind.
        let mut account = self.index.account().clone();
        let bytes = account.try_borrow()?;
        require!(bytes.len() >= 8, crate::ClearingError::Profile);
        let mut discriminator = [0u8; 8];
        discriminator.copy_from_slice(&bytes[..8]);
        drop(bytes);
        if discriminator == *crate::state::accounts::MemberIndexNode::DISCRIMINATOR {
            scope.raw::<crate::state::accounts::MemberIndexNode>(&mut account, Access::Read)?;
        } else {
            scope.raw::<crate::state::accounts::MemberPage>(&mut account, Access::Read)?;
        }
        Ok(())
    }
    fn venue(&self) -> (Address, [u8; 32]) {
        (*self.source.venue.address(), self.source.venue.domain)
    }
    fn event_authority(&self) -> AccountView {
        self.event_authority.account().clone()
    }
}

context!(InitializeSettlementLimbPage, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    page: Write,
];
[]);

context!(AcceptDenominatorRow, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Write,
    page: Read,
];
[]);

context!(ContinueSettlementDenominator, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Write,
];
[]);

context!(InitializeSettlementRates, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Write,
];
[]);

context!(ManageSettlementProposal, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Write,
];
[]);

context!(UploadSettlementRate, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Write,
    page: Write,
];
[]);

context!(PrepareRateScratch, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    page: Write,
];
[]);

context!(AcceptSettlementRateRow, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Write,
    page: Read,
];
[]);

context!(ContinueSettlementRates, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Write,
];
[]);

context!(InitializeSettlementPlan, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Write,
];
[]);

context!(InitializeSettlementPlanPage, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Read,
    page: Write,
];
[]);

context!(AcceptSettlementPlanRow, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Write,
    page: Read,
];
[]);

context!(ManageSettlementPlan, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Write,
];
[]);

context!(ContinueSettlementPlan, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Write,
];
[]);

context!(AdoptSettlementPlan, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Write,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Write,
];
[]);

context!(ApplySettlementMargin, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Write,
    source.eth: Write,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Write,
    page: Read,
    margin: Write,
    flow_page: Write,
];
[]);

context!(CompleteSettlementApplication, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Write,
    source.eth_ledger: Write,
    prepared: Read,
    rates: Read,
    plan: Write,
];
[]);

context!(ReconcileSettlementMargin, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.storage: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Write,
    page: Read,
    margin: Read,
    flow_page: Read,
];
[]);

context!(CompleteSettlementPlan, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Write,
    source.registry: Read,
    source.storage: Write,
    source.resolution: Write,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Read,
    plan: Write,
];
[]);

context!(ChangeMarginMembership, venue, event_authority;
[venue: Read, safety: Read, registry: Write, portfolio: Read, margin: Write, members: Write, storage: Read]; []);
impl ScopedContext for RetireMargin {
    fn visit(&mut self, scope: &mut Scope) -> Result<()> {
        scope.account(&mut self.venue, Access::Read)?;
        scope.account(&mut self.safety, Access::Read)?;
        scope.account(&mut self.registry, Access::Write)?;
        scope.account(&mut self.portfolio, Access::Write)?;
        scope.retire_margin(&mut self.margin.account().clone())?;
        scope.account(&mut self.members, Access::Write)
    }
    fn venue(&self) -> (Address, [u8; 32]) { (*self.venue.address(), self.venue.domain) }
    fn event_authority(&self) -> AccountView { self.event_authority.account().clone() }
}

impl ScopedContext for RefundRecoveryAllocation {
    fn visit(&mut self, scope: &mut Scope) -> Result<()> {
        scope.account(&mut self.venue, Access::Read)?;
        scope.account(&mut self.safety, Access::Read)?;
        scope.account(&mut self.storage, Access::Write)?;
        scope.retire_storage(&mut self.allocation.account().clone())?;
        scope.account(&mut self.receipt, Access::Read)
    }
    fn venue(&self) -> (Address, [u8;32]) { (*self.venue.address(),self.venue.domain) }
    fn event_authority(&self) -> AccountView { self.event_authority.account().clone() }
}

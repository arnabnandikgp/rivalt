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
];
[
]);

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
    work: Write,
    target: Read,
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
    work: Create,
];
[
]);

context!(InitializeAccountResolutionPage, venue, event_authority;
[
    venue: Read,
    custody: Read,
    safety: Read,
    resolution: Write,
    page: Create,
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
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Create,
];
[]);

context!(InitializePreparedIndexNode, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Write,
    node: Create,
];
[]);

context!(InitializePreparedMembers, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Write,
    page: Create,
];
[]);

context!(InitializeFrozenMarginPage, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    page: Create,
];
[]);

context!(ValuePreparedMember, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
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
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    page: Create,
];
[]);

context!(AcceptDenominatorRow, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
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
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Create,
];
[]);

context!(ManageSettlementProposal, source.venue, event_authority;
[
    source.venue: Read,
    source.custody: Read,
    source.safety: Read,
    source.registry: Read,
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
    source.resolution: Read,
    source.btc: Read,
    source.eth: Read,
    source.btc_ledger: Read,
    source.eth_ledger: Read,
    prepared: Read,
    rates: Write,
];
[]);

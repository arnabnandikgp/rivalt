//! Current instruction contexts and domain handlers.
mod types;
pub use crate::engine::routes::OrderAction;
pub use types::*;
pub mod account_cash;
pub mod account_custody;
pub(crate) mod account_membership;
pub mod account_safety;
pub mod account_trading;
pub mod maker_liquidity;
pub(crate) use account_cash::__client_accounts_accountfinancialidentity;
pub(crate) use account_cash::__client_accounts_changeaccountclaim;
pub(crate) use account_cash::__client_accounts_netaccountclaims;
pub(crate) use account_cash::__client_accounts_transferfundedaccount;
pub(crate) use account_cash::__client_accounts_withdrawfundedaccount;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::__cpi_accounts_accountfinancialidentity;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::__cpi_accounts_changeaccountclaim;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::__cpi_accounts_netaccountclaims;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::__cpi_accounts_transferfundedaccount;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::__cpi_accounts_withdrawfundedaccount;
pub(crate) use account_cash::certificate::__client_accounts_checkmarketbacking;
pub(crate) use account_cash::certificate::__client_accounts_initializemarketbacking;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::certificate::__cpi_accounts_checkmarketbacking;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::certificate::__cpi_accounts_initializemarketbacking;
pub use account_cash::certificate::CheckMarketBacking;
pub use account_cash::certificate::InitializeMarketBacking;
pub(crate) use account_cash::fees::__client_accounts_allocatemarketfees;
pub(crate) use account_cash::fees::__client_accounts_withdrawmarketfees;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::fees::__cpi_accounts_allocatemarketfees;
#[cfg(feature = "cpi")]
pub(crate) use account_cash::fees::__cpi_accounts_withdrawmarketfees;
pub use account_cash::fees::{AllocateMarketFees, WithdrawMarketFees};
pub use account_cash::AccountFinancialIdentity;
pub use account_cash::ChangeAccountClaim;
pub use account_cash::NetAccountClaims;
pub use account_cash::TransferFundedAccount;
pub use account_cash::WithdrawFundedAccount;
pub(crate) use account_custody::__client_accounts_accountcash;
pub(crate) use account_custody::__client_accounts_classifymarketsurplus;
pub(crate) use account_custody::__client_accounts_createportfolio;
pub(crate) use account_custody::__client_accounts_initializemarket;
pub(crate) use account_custody::__client_accounts_initializevenue;
pub(crate) use account_custody::__client_accounts_initializevenueregistry;
pub(crate) use account_custody::__client_accounts_pausevenue;
pub(crate) use account_custody::__client_accounts_registermargin;
pub(crate) use account_custody::__client_accounts_seedmarketinsurance;
pub(crate) use account_custody::__client_accounts_transferaccountcustody;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_accountcash;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_classifymarketsurplus;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_createportfolio;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_initializemarket;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_initializevenue;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_initializevenueregistry;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_pausevenue;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_registermargin;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_seedmarketinsurance;
#[cfg(feature = "cpi")]
pub(crate) use account_custody::__cpi_accounts_transferaccountcustody;
pub use account_custody::AccountCash;
pub use account_custody::ClassifyMarketSurplus;
pub use account_custody::CreatePortfolio;
pub use account_custody::InitializeMarket;
pub use account_custody::InitializeVenue;
pub use account_custody::InitializeVenueRegistry;
pub use account_custody::PauseVenue;
pub use account_custody::RegisterMargin;
pub use account_custody::SeedMarketInsurance;
pub use account_custody::TransferAccountCustody;
pub(crate) use account_safety::resolution::__client_accounts_freezeaccounts;
pub(crate) use account_safety::resolution::__client_accounts_initializeaccountresolution;
pub(crate) use account_safety::resolution::__client_accounts_recoveraccounts;
pub(crate) use account_safety::resolution::__client_accounts_resolutionidentity;
pub(crate) use account_safety::resolution::__client_accounts_resolutionsources;
pub(crate) use account_safety::resolution::__client_accounts_valueaccountresolution;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::__cpi_accounts_freezeaccounts;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::__cpi_accounts_initializeaccountresolution;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::__cpi_accounts_recoveraccounts;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::__cpi_accounts_resolutionidentity;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::__cpi_accounts_resolutionsources;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::__cpi_accounts_valueaccountresolution;
pub(crate) use account_safety::resolution::retirement::__client_accounts_checkaccountretirement;
pub(crate) use account_safety::resolution::retirement::__client_accounts_initializeaccountretirement;
pub(crate) use account_safety::resolution::retirement::__client_accounts_retireaccounts;
pub(crate) use account_safety::resolution::retirement::__client_accounts_withdrawretiredreserve;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::retirement::__cpi_accounts_checkaccountretirement;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::retirement::__cpi_accounts_initializeaccountretirement;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::retirement::__cpi_accounts_retireaccounts;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::resolution::retirement::__cpi_accounts_withdrawretiredreserve;
pub use account_safety::resolution::retirement::CheckAccountRetirement;
pub use account_safety::resolution::retirement::InitializeAccountRetirement;
pub use account_safety::resolution::retirement::RetireAccounts;
pub use account_safety::resolution::retirement::WithdrawRetiredReserve;
pub use account_safety::resolution::FreezeAccounts;
pub use account_safety::resolution::InitializeAccountResolution;
pub use account_safety::resolution::RecoverAccounts;
pub use account_safety::resolution::ResolutionIdentity;
pub use account_safety::resolution::ResolutionSources;
pub use account_safety::resolution::ValueAccountResolution;
pub(crate) use account_safety::risk::__client_accounts_liquidateaccount;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::risk::__cpi_accounts_liquidateaccount;
pub use account_safety::risk::LiquidateAccount;
pub(crate) use account_trading::__client_accounts_accountrouteidentity;
#[cfg(feature = "cpi")]
pub(crate) use account_trading::__cpi_accounts_accountrouteidentity;
pub(crate) use account_trading::activation::__client_accounts_activateaccounts;
pub(crate) use account_trading::activation::__client_accounts_qualifyaccounttrading;
#[cfg(feature = "cpi")]
pub(crate) use account_trading::activation::__cpi_accounts_activateaccounts;
#[cfg(feature = "cpi")]
pub(crate) use account_trading::activation::__cpi_accounts_qualifyaccounttrading;
pub use account_trading::activation::ActivateAccounts;
pub use account_trading::activation::QualifyAccountTrading;
pub(crate) use account_trading::authority::__client_accounts_manageaccountorder;
pub(crate) use account_trading::authority::__client_accounts_setaccountdelegate;
#[cfg(feature = "cpi")]
pub(crate) use account_trading::authority::__cpi_accounts_manageaccountorder;
#[cfg(feature = "cpi")]
pub(crate) use account_trading::authority::__cpi_accounts_setaccountdelegate;
pub use account_trading::authority::ManageAccountOrder;
pub use account_trading::authority::SetAccountDelegate;
pub(crate) use account_trading::oracle::__client_accounts_initializeaccountoracle;
#[cfg(feature = "cpi")]
pub(crate) use account_trading::oracle::__cpi_accounts_initializeaccountoracle;
pub use account_trading::oracle::InitializeAccountOracle;
pub use account_trading::AccountRouteIdentity;
pub(crate) use maker_liquidity::__client_accounts_controlliquidity;
pub(crate) use maker_liquidity::__client_accounts_initializeliquidity;
pub(crate) use maker_liquidity::__client_accounts_quarantineliquidity;
pub(crate) use maker_liquidity::__client_accounts_registerliquidity;
pub(crate) use maker_liquidity::__client_accounts_sealliquidity;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::__cpi_accounts_controlliquidity;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::__cpi_accounts_initializeliquidity;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::__cpi_accounts_quarantineliquidity;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::__cpi_accounts_registerliquidity;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::__cpi_accounts_sealliquidity;
pub(crate) use maker_liquidity::publisher::__client_accounts_configurefundingpublisher;
pub(crate) use maker_liquidity::publisher::__client_accounts_initializefundingpublisher;
pub(crate) use maker_liquidity::publisher::__client_accounts_publishfundingreport;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::publisher::__cpi_accounts_configurefundingpublisher;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::publisher::__cpi_accounts_initializefundingpublisher;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::publisher::__cpi_accounts_publishfundingreport;
pub use maker_liquidity::publisher::ConfigureFundingPublisher;
pub use maker_liquidity::publisher::InitializeFundingPublisher;
pub use maker_liquidity::publisher::PublishFundingReport;
pub(crate) use maker_liquidity::routes::__client_accounts_executeliquidityroute;
#[cfg(feature = "cpi")]
pub(crate) use maker_liquidity::routes::__cpi_accounts_executeliquidityroute;
pub use maker_liquidity::routes::ExecuteLiquidityRoute;
pub use maker_liquidity::routes::{LiquidityOrderExecution, LiquidityRouteIntent};
pub use maker_liquidity::ControlLiquidity;
pub use maker_liquidity::InitializeLiquidity;
pub use maker_liquidity::QuarantineLiquidity;
pub use maker_liquidity::RegisterLiquidity;
pub use maker_liquidity::SealLiquidity;

mod scopes;

// Authenticated successor verification; no payout or trading authority.
pub(crate) use account_safety::settlement::__client_accounts_acceptdenominatorrow;
pub(crate) use account_safety::settlement::__client_accounts_advancepreparedmembership;
pub(crate) use account_safety::settlement::__client_accounts_continuesettlementdenominator;
pub(crate) use account_safety::settlement::__client_accounts_initializefrozenmarginpage;
pub(crate) use account_safety::settlement::__client_accounts_initializepreparedsettlement;
pub(crate) use account_safety::settlement::__client_accounts_initializesettlementlimbpage;
pub(crate) use account_safety::settlement::__client_accounts_preparedsourceidentity;
pub(crate) use account_safety::settlement::__client_accounts_valuepreparedmember;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_acceptdenominatorrow;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_advancepreparedmembership;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_continuesettlementdenominator;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_initializefrozenmarginpage;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_initializepreparedsettlement;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_initializesettlementlimbpage;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_preparedsourceidentity;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_valuepreparedmember;
pub use account_safety::settlement::AcceptDenominatorRow;
pub use account_safety::settlement::AdvancePreparedMembership;
pub use account_safety::settlement::ContinueSettlementDenominator;
pub use account_safety::settlement::InitializeFrozenMarginPage;
pub use account_safety::settlement::InitializePreparedSettlement;
pub use account_safety::settlement::InitializeSettlementLimbPage;
pub use account_safety::settlement::PreparedSourceIdentity;
pub use account_safety::settlement::ValuePreparedMember;

pub(crate) use account_safety::settlement::__client_accounts_initializesettlementrates;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_initializesettlementrates;
pub use account_safety::settlement::InitializeSettlementRates;

pub(crate) use account_safety::settlement::__client_accounts_managesettlementproposal;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_managesettlementproposal;
pub use account_safety::settlement::ManageSettlementProposal;

pub(crate) use account_safety::settlement::__client_accounts_uploadsettlementrate;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_uploadsettlementrate;
pub use account_safety::settlement::UploadSettlementRate;

pub(crate) use account_safety::settlement::__client_accounts_prepareratescratch;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_prepareratescratch;
pub use account_safety::settlement::PrepareRateScratch;

pub(crate) use account_safety::settlement::__client_accounts_acceptsettlementraterow;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_acceptsettlementraterow;
pub use account_safety::settlement::AcceptSettlementRateRow;

pub(crate) use account_safety::settlement::__client_accounts_continuesettlementrates;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_continuesettlementrates;
pub use account_safety::settlement::ContinueSettlementRates;

pub(crate) use account_safety::settlement::__client_accounts_initializesettlementplan;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_initializesettlementplan;
pub use account_safety::settlement::InitializeSettlementPlan;

pub(crate) use account_safety::settlement::__client_accounts_initializesettlementplanpage;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_initializesettlementplanpage;
pub use account_safety::settlement::InitializeSettlementPlanPage;

pub(crate) use account_safety::settlement::__client_accounts_acceptsettlementplanrow;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_acceptsettlementplanrow;
pub use account_safety::settlement::AcceptSettlementPlanRow;

pub(crate) use account_safety::settlement::__client_accounts_managesettlementplan;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_managesettlementplan;
pub use account_safety::settlement::ManageSettlementPlan;

pub(crate) use account_safety::settlement::__client_accounts_continuesettlementplan;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_continuesettlementplan;
pub use account_safety::settlement::ContinueSettlementPlan;

pub(crate) use account_safety::settlement::__client_accounts_adoptsettlementplan;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_adoptsettlementplan;
pub use account_safety::settlement::AdoptSettlementPlan;

pub(crate) use account_safety::settlement::__client_accounts_adoptionsourceidentity;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_adoptionsourceidentity;
pub use account_safety::settlement::AdoptionSourceIdentity;

pub(crate) use account_safety::settlement::__client_accounts_applysettlementmargin;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_applysettlementmargin;
pub use account_safety::settlement::ApplySettlementMargin;

pub(crate) use account_safety::settlement::__client_accounts_applicationsourceidentity;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_applicationsourceidentity;
pub use account_safety::settlement::ApplicationSourceIdentity;

pub(crate) use account_safety::settlement::__client_accounts_completesettlementapplication;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_completesettlementapplication;
pub use account_safety::settlement::CompleteSettlementApplication;

pub(crate) use account_safety::settlement::__client_accounts_distributionsourceidentity;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_distributionsourceidentity;
pub use account_safety::settlement::DistributionSourceIdentity;

pub(crate) use account_safety::settlement::__client_accounts_reconcilesettlementmargin;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_reconcilesettlementmargin;
pub use account_safety::settlement::ReconcileSettlementMargin;

pub(crate) use account_safety::settlement::__client_accounts_completesettlementplan;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_completesettlementplan;
pub use account_safety::settlement::CompleteSettlementPlan;

pub(crate) use account_safety::settlement::__client_accounts_completionsourceidentity;
#[cfg(feature = "cpi")]
pub(crate) use account_safety::settlement::__cpi_accounts_completionsourceidentity;
pub use account_safety::settlement::CompletionSourceIdentity;

pub use account_membership::InitializeRecoveryStorage;
pub(crate) use account_membership::__client_accounts_initializerecoverystorage;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_initializerecoverystorage;

pub use account_membership::ConfigureRecoveryStorage;
pub(crate) use account_membership::__client_accounts_configurerecoverystorage;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_configurerecoverystorage;

pub use account_membership::FundRecoveryAllocation;
pub(crate) use account_membership::__client_accounts_fundrecoveryallocation;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_fundrecoveryallocation;

pub use account_membership::VerifyRecoveryAllocation;
pub(crate) use account_membership::__client_accounts_verifyrecoveryallocation;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_verifyrecoveryallocation;

pub use account_membership::FundMemberPage;
pub(crate) use account_membership::__client_accounts_fundmemberpage;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_fundmemberpage;

pub use account_membership::FundMemberIndex;
pub(crate) use account_membership::__client_accounts_fundmemberindex;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_fundmemberindex;

pub use account_membership::ChangeMarginMembership;
pub(crate) use account_membership::__client_accounts_changemarginmembership;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_changemarginmembership;

pub use account_membership::RetireMargin;
pub(crate) use account_membership::__client_accounts_retiremargin;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_retiremargin;

pub use account_membership::RefundRecoveryAllocation;
pub(crate) use account_membership::__client_accounts_refundrecoveryallocation;
#[cfg(feature="cpi")]
pub(crate) use account_membership::__cpi_accounts_refundrecoveryallocation;

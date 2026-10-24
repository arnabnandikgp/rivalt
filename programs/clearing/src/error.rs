//! Stable program error codes; explicit discriminants preserve the published ABI.
use anchor_lang::prelude::*;

#[error_code]
pub enum ClearingError {
    #[msg("The maximum nonce is reserved for the local rejection probe")]
    ReservedNonce,
    #[msg("Custody arithmetic bound or overflow")]
    Arithmetic = 100,
    #[msg("Market is paused")]
    Paused,
    #[msg("Wrong authority")]
    Authority,
    #[msg("Expected classic SPL six-decimal collateral without freeze authority")]
    Mint,
    #[msg("Source and destination roles alias")]
    Alias,
    #[msg("Participant registry is full")]
    Capacity,
    #[msg("Amount must be positive")]
    Amount,
    #[msg("Actual vault is below allocated cash or cash totals disagree")]
    Reconciliation,
    #[msg("Financial state is outside the implemented phase profile")]
    Profile,
    #[msg("Domain identity must be nonzero")]
    Domain,
    #[msg("Maker program, config or capital binding mismatch")]
    MakerBinding,
    #[msg("Maker capital is unfunded or outside the implemented profile")]
    MakerCapital,
    #[msg("Maker or market epoch mismatch or expired quote")]
    MakerEpoch,
    #[msg("Maker registration is quarantined")]
    MakerQuarantined,
    #[msg("Maker deployment differs from approved ProgramData hash")]
    MakerUpgrade,
    #[msg("Maker quote exceeds price, size or capacity bounds")]
    MakerQuote,
    #[msg("Maker response producer, encoding or terms mismatch")]
    MakerResponse,
    #[msg("Route authority, quantity, lifetime, nonce or generation mismatch")]
    RouteIntent,
    #[msg("Synthetic observation is unavailable, stale or mismatched")]
    RiskObservation,
    #[msg("Route exceeds all-in, fee or execution bounds")]
    RouteLimit,
    #[msg("Post-fee health or exposure capacity fails")]
    RouteHealth,
    #[msg("Exit cohort is incomplete, insolvent, foreign or stale")]
    ExitCohort,
    #[msg("Financial action is bound to a different market sequence")]
    FinancialSequence,
    #[msg("Oracle source identity, verification or schema mismatch")]
    OracleSource,
    #[msg("Oracle action mode, sample timing or source policy rejects action")]
    OraclePolicy,
    #[msg("Stored order identity, version, prefix or state mismatch")]
    OrderState,
    #[msg("Order quantity, limits, lifetime, trigger or generation rejected")]
    OrderTerms,
    #[msg("No free bounded order/protective-group slot")]
    OrderSlots,
    #[msg("Current central index does not satisfy stored trigger")]
    OrderTrigger,
    #[msg("Liquidation receiver, funded fee or strict risk progress check failed")]
    Liquidation,
    #[msg("Resolution epoch, stage, cursor, cohort or accounting check failed")]
    Resolution,
}

//! Schema-3 market-attributed terminal clearing. No runtime authority is supplied
//! by this module; the program must authenticate the complete frozen cohort.
pub mod row;
pub mod wide;
pub mod circulation;
pub mod atoms;

/// Successor scratch kernel; no program activation or payout authority.
pub mod scalable;

/// Native residual-settlement qualification. No program instruction selects this model.
#[cfg(all(feature = "market-settlement-model", not(target_os = "solana")))]
pub mod market_settlement;
#[cfg(all(feature = "three-market-model", not(target_os = "solana")))]
pub use market_settlement as three_market;

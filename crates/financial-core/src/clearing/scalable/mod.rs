//! P54 exact scalable settlement kernel under construction. No runtime authority
//! or expanded account admission is exposed by these arithmetic primitives.
//! P54B owns authenticated account pages and persisted continuation fences.
pub mod active_work;
pub mod atom_division;
pub mod cohort_denominator;
pub mod collection;
pub mod comparison;
pub mod denominator;
pub mod flow_work;
pub mod graph_build;
pub mod graph_pages;
pub mod graph_work;
pub mod insurance_rounds;
pub mod membership;
pub mod normalized;
pub mod order_work;
pub mod pages;
pub mod rate_work;
pub mod snapshot;
pub mod wide;

// Native complete-kernel orchestration. These vector-backed schedules supply
// arithmetic/rounding evidence, not on-chain pages or activation. P54B/P54C bind
// the bounded steps to authenticated storage before any runtime can use them.
#[cfg(not(target_os = "solana"))]
pub mod active;
#[cfg(not(target_os = "solana"))]
pub mod number;
#[cfg(not(target_os = "solana"))]
pub mod rounding;
#[cfg(not(target_os = "solana"))]
pub mod settlement;

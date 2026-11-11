//! P54 exact scalable settlement kernel under construction. No runtime authority
//! or expanded account admission is exposed by these arithmetic primitives.
//! P54B owns authenticated account pages and persisted continuation fences.
pub mod collection;
pub mod denominator;
pub mod wide;

// Native complete-kernel orchestration. These vector-backed schedules supply
// arithmetic/rounding evidence, not on-chain pages or activation. P54B/P54C bind
// the bounded steps to authenticated storage before any runtime can use them.
#[cfg(not(target_arch = "bpf"))]
pub mod active;
#[cfg(not(target_arch = "bpf"))]
pub mod number;
#[cfg(not(target_arch = "bpf"))]
pub mod rounding;
#[cfg(not(target_arch = "bpf"))]
pub mod settlement;

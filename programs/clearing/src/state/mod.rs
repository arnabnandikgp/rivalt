//! Authoritative account layouts. Field order and PDA derivations are compatibility contracts.

mod maker;
pub use maker::*;
mod market;
pub use market::*;
mod oracle;
pub use oracle::*;
mod order;
pub use order::*;
mod participant;
pub use participant::*;
mod probe;
pub use probe::*;
mod resolution;
pub use resolution::*;
mod route;
pub use route::*;
mod settlement;
pub use settlement::*;
/// Successor layout contract; no V2 financial entrypoint is enabled by these types.
pub mod v2;

/// Fresh account-centric contract layouts; financial activation remains disabled.
pub mod v3;

/// Canonical maker registry; profile-4 financial execution is not activated here.
pub mod v4;

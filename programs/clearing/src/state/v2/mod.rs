//! Schema 2 is a fresh test group, never an in-place reinterpretation of V1.
//! Fixed position slots authenticate the complete health universe. These layouts
//! alone grant no custody, trading, delegation or resolution authority.
use anchor_lang::prelude::*;

pub(crate) use crate::state::records::deserialize_cohort;

mod group;
mod margin;
mod market;
mod resolution;
pub use group::*;
pub use margin::*;
pub use market::*;
pub use resolution::*;

pub const SCHEMA_VERSION: u16 = 2;
pub const PROFILE_VERSION: u16 = 2;
pub use crate::state::identity::*;
pub use crate::state::records::{Position, StoredOrder, Protection, OrderBook};

/// P20 qualifies cross only in this explicit local profile. Default/devnet and
/// the older isolated profile still reject cross; group activation is required.
pub const CROSS_TRADING_IMPLEMENTED: bool = cfg!(feature = "cross-safety-qualification");
/// Retain the profile selector without an unqualified arithmetic bypass.
/// The historical qualification feature now selects the verified local artifact.
pub(crate) const fn cross_profile_enabled() -> bool {
    CROSS_TRADING_IMPLEMENTED
}
/// P18C safety candidate is executable only in the explicit local test profile.
/// Publication still requires A23C acceptance; default/devnet builds reject it.
pub const ISOLATED_TRADING_IMPLEMENTED: bool = cfg!(feature = "successor-test-profile");

#[cfg(test)]
mod tests;

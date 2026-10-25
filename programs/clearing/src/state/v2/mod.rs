//! Schema 2 is a fresh test group, never an in-place reinterpretation of V1.
//! Fixed position slots authenticate the complete health universe. These layouts
//! alone grant no custody, trading, delegation or resolution authority.
use anchor_lang::prelude::*;

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
pub const MARKET_COUNT: usize = 2;
pub const MAX_MEMBERS: usize = 64;
pub const MAX_PORTFOLIOS: u16 = 4;
pub const MAX_SUBACCOUNT: u16 = 8;
pub const CROSS_MARKET_SENTINEL: u8 = u8::MAX;

pub const MODE_CROSS: u8 = 0;
pub const MODE_ISOLATED: u8 = 1;
pub const ROLE_TRADER: u8 = 0;
pub const ROLE_MAKER: u8 = 1;
pub const ROLE_RECEIVER: u8 = 2;

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

/// Borsh's generic Vec reader grows its allocation while decoding. The SBF
/// bump allocator cannot reclaim those buffers. Allocate the bounded cohort once
/// while retaining precisely the same u32-length + element wire representation.
pub(crate) fn deserialize_cohort<R: std::io::Read, T: AnchorDeserialize>(
    reader: &mut R,
) -> std::io::Result<Vec<T>> {
    let count = u32::deserialize_reader(reader)? as usize;
    if count > MAX_MEMBERS {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "group cohort exceeds 64 members",
        ));
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        entries.push(T::deserialize_reader(reader)?);
    }
    Ok(entries)
}

/// Validate immutable account identity separately from runtime health/authority.
pub fn valid_identity(
    portfolio_index: u16,
    subaccount_index: u16,
    mode: u8,
    isolated_market_index: u8,
    role: u8,
) -> bool {
    portfolio_index < MAX_PORTFOLIOS
        && subaccount_index <= MAX_SUBACCOUNT
        && role <= ROLE_RECEIVER
        && match mode {
            MODE_CROSS => {
                subaccount_index == 0
                    && isolated_market_index == CROSS_MARKET_SENTINEL
                    && role != ROLE_MAKER
            }
            MODE_ISOLATED => {
                subaccount_index > 0 && usize::from(isolated_market_index) < MARKET_COUNT
            }
            _ => false,
        }
}

#[cfg(test)]
mod tests;

//! Shared deterministic financial transitions. Instruction modules authenticate
//! accounts and authority before computing candidates and committing their results.
//! The historical scalar adapters are retired separately from this mechanical move.
use crate::{
    error::ClearingError,
    state::{accounts::*, records::*},
};
use account::{commit_model, model};
use anchor_lang::prelude::*;
use financial_core as math;

pub(crate) mod account;
pub(crate) mod authority;
pub(crate) mod book;
pub(crate) mod markets;
pub(crate) mod oracle;
pub(crate) mod risk;
pub mod routes;
pub(crate) mod sources;

pub(crate) fn checked<T>(value: math::Result<T>) -> Result<T> {
    value.map_err(|_| error!(ClearingError::Arithmetic))
}

pub(crate) fn risk(market: &Market, funding: i128) -> Result<[math::margin::Risk; 2]> {
    require!(
        market.index < 2 && market.schema_version == SCHEMA_VERSION,
        ClearingError::Profile
    );
    let mut risks = [math::margin::Risk::default(); 2];
    risks[usize::from(market.index)] = math::margin::Risk {
        lower: market.lower,
        upper: market.upper,
        funding,
    };
    Ok(risks)
}

pub(crate) fn advance(root: &mut MarginAccount) -> Result<()> {
    root.state_version = root
        .state_version
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(())
}

#[cfg(test)]
mod tests;

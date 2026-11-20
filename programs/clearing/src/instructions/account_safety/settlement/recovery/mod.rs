//! Local clearing-owned proof of a bounded, complete frozen recovery. The
//! diagnostic program compiles these same source modules under its own ID.
#[cfg(feature = "recovery-search-qualification")]
use crate as clearing_program;
#[cfg(feature = "recovery-search-qualification")]
use crate::profit_attribution::frozen_history as read_profit_history;
use crate::state::accounts::{FrozenMarginPage, MarginAccount, PreparedSettlement, Resolution};
use anchor_lang::prelude::*;
#[cfg(feature = "recovery-search-qualification")]
pub mod binding;
#[cfg(feature = "recovery-search-qualification")]
mod inputs;
pub mod layout;
#[cfg(feature = "recovery-search-qualification")]
mod priority;
#[cfg(feature = "recovery-search-qualification")]
pub mod search;
#[cfg(feature = "recovery-search-qualification")]
mod source;
pub use layout::*;

#[cfg(feature = "recovery-search-qualification")]
pub use crate::ClearingError as ProofError;

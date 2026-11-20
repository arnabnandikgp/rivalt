//! Local clearing-owned proof of a bounded, complete frozen recovery. The
//! diagnostic program compiles these same source modules under its own ID.
use crate as clearing_program;
use crate::profit_attribution::frozen_history as read_profit_history;
use crate::state::accounts::{FrozenMarginPage, MarginAccount, PreparedSettlement, Resolution};
use anchor_lang::prelude::*;
pub mod binding;
mod inputs;
mod priority;
pub mod search;
mod source;
pub use inputs::*;
pub use search::{AdvanceSearch, CaptureSearch, OpenSearch, RecoverySearch};

#[error_code(offset = 7100)]
pub enum ProofError {
    Source,
    Cursor,
    Commitment,
    Unsupported,
    Charge,
    Incomplete,
    Priority,
    Accounting,
}

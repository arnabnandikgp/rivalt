//! Profile-4 source initialization and complete sealed-registry sampling. A
//! missing valid price degrades the observation; substituted identities reject.
use super::*;
use crate::instructions::account_trading::{self, oracle::InitializeAccountOracle};

pub fn initialize(
    ctx: &mut Context<InitializeAccountOracle>,
    events: &mut crate::event_cpi::Payloads,
    primary: Pubkey,
    guard: Pubkey,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    execution_profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
        &ctx.accounts.market,
    )?;
    account_trading::oracle::initialize_accounts(ctx, events, primary, guard)
}

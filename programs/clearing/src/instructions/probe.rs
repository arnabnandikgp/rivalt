use crate::error::ClearingError;
use crate::events::ProbeRecorded;
use crate::state::{ProbeChoice, ProbeRecord};

use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Probe<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + ProbeRecord::INIT_SPACE,
        seeds = [b"probe", owner.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub record: Account<'info, ProbeRecord>,
    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: Context<Probe>,
    nonce: u64,
    signed_value: i128,
    optional_value: Option<u64>,
    choice: ProbeChoice,
) -> Result<()> {
    // A deterministic rejection lets RPC tests distinguish failed logs from committed state.
    require!(nonce != u64::MAX, ClearingError::ReservedNonce);
    let record = &mut ctx.accounts.record;
    record.owner = ctx.accounts.owner.key();
    record.nonce = nonce;
    record.signed_value = signed_value;
    record.optional_value = optional_value;
    record.choice = choice;
    record.bump = ctx.bumps.record;
    emit_cpi!(ProbeRecorded {
        schema_version: 1,
        owner: record.owner,
        record: record.key(),
        nonce,
        signed_value,
        optional_value,
        choice,
    });
    Ok(())
}

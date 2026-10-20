use anchor_lang::prelude::*;

declare_id!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo");

/// P01 local ABI/RPC probe. No financial instruction is implemented or enabled.
#[program]
pub mod clearing {
    use super::*;

    pub fn probe(
        ctx: Context<Probe>,
        nonce: u64,
        signed_value: i128,
        optional_value: Option<u64>,
        choice: ProbeChoice,
    ) -> Result<()> {
        // A deterministic rejection lets RPC tests distinguish failed logs from committed state.
        require!(nonce != u64::MAX, ProbeError::ReservedNonce);
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
}

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
        bump
    )]
    pub record: Account<'info, ProbeRecord>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ProbeRecord {
    pub owner: Pubkey,
    pub nonce: u64,
    pub signed_value: i128,
    pub optional_value: Option<u64>,
    pub choice: ProbeChoice,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum ProbeChoice {
    Empty,
    Number { value: u64 },
}

#[event]
pub struct ProbeRecorded {
    pub schema_version: u16,
    pub owner: Pubkey,
    pub record: Pubkey,
    pub nonce: u64,
    pub signed_value: i128,
    pub optional_value: Option<u64>,
    pub choice: ProbeChoice,
}

#[error_code]
pub enum ProbeError {
    #[msg("The maximum nonce is reserved for the local rejection probe")]
    ReservedNonce,
}

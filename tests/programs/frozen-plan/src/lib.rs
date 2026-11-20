//! Local measurement program. Every account owned by clearing is read-only.
//! A sealed receipt describes a result on one frozen source revision.
use anchor_lang::prelude::*;
use clearing::state::accounts::{FrozenMarginPage, MarginAccount, PreparedSettlement, Resolution};
use solana_sha256_hasher::hashv;
mod kernel;
mod source;
use kernel::*;
mod verify;
declare_id!("92GA4Cm7NZq8GEwY5r7zLwdLeYLuQYa79Ut9f3gAQ8U7");

#[account(borsh)]
#[derive(Default, InitSpace)]
pub struct Comparison {
    pub source: Address,
    pub epoch: u64,
    pub revision: u64,
    pub cursor: u64,
    pub count: u64,
    pub debtor: u64,
    pub targets: [u64; 2],
    pub shares: [u64; 2],
    pub used_insurance: [u64; 2],
    pub recovered: [u64; 2],
    pub opening_lots: [i64; 2],
    pub charged_lots: [u64; 2],
    pub total_cash: u64,
    pub remaining: [u8; 32],
    pub outcome: [u8; 32],
    pub sealed: bool,
    pub boundaries: [Cut; 2],
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Default, Clone, Copy)]
pub struct Cut {
    // Unit zero is the empty sentinel. Positive units have a positive capacity.
    pub last: [u64; 4],
    pub next: [u64; 4],
}

#[derive(Accounts)]
pub struct Source {
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    pub resolution: Box<BorshAccount<Resolution>>,
}
#[derive(Accounts)]
#[instruction(nonce:u64)]
pub struct Begin {
    #[account(mut)]
    pub payer: Signer,
    #[account(init,payer=payer,space=8+Comparison::INIT_SPACE,
        seeds=[b"linked-check",payer.address().as_ref(),&nonce.to_le_bytes()],bump)]
    pub comparison: Box<BorshAccount<Comparison>>,
    pub source: Nested<Source>,
    pub page: Box<BorshAccount<FrozenMarginPage>>,
    pub system_program: Program<System>,
}
#[derive(Accounts)]
pub struct Step {
    #[account(mut)]
    pub comparison: Box<BorshAccount<Comparison>>,
    pub source: Nested<Source>,
    pub page: Box<BorshAccount<FrozenMarginPage>>,
    pub margin: Box<BorshAccount<MarginAccount>>,
}
#[derive(Accounts)]
pub struct Seal {
    #[account(mut)]
    pub comparison: Box<BorshAccount<Comparison>>,
    pub source: Nested<Source>,
}

#[program]
pub mod frozen_plan_probe {
    use super::*;
    pub fn audit_settlement(
        ctx: &mut Context<AuditSettlement>,
        epoch: u64,
        revision: u64,
        phase: u8,
        before: RateWitness,
        after: RateWitness,
    ) -> Result<[u64; 8]> {
        kernel::audit(&ctx.accounts, epoch, revision, phase, before, after)
    }
    pub fn begin(
        ctx: &mut Context<Begin>,
        _nonce: u64,
        epoch: u64,
        debtor_ordinal: u64,
        commitment: [u8; 32],
    ) -> Result<()> {
        let accounts = &mut ctx.accounts;
        accounts.source.check(epoch)?;
        let header = &accounts.source.prepared;
        let debtor = source::row(header, &accounts.page, debtor_ordinal)?;
        verify::begin(&mut accounts.comparison, header, debtor, commitment)
    }
    pub fn step(
        ctx: &mut Context<Step>,
        ordinal: u64,
        charges: [u64; 2],
        suffix: [u8; 32],
    ) -> Result<()> {
        let accounts = &mut ctx.accounts;
        let proof = &mut accounts.comparison;
        accounts.source.resume(proof)?;
        require!(
            ordinal == proof.cursor && ordinal < proof.count,
            ProofError::Cursor
        );
        let header = &accounts.source.prepared;
        let row = source::row(header, &accounts.page, ordinal)?;
        source::original(row, header, &accounts.margin)?;
        let digest = hashv(&[
            b"Rivalt/linked-charges/v1",
            &ordinal.to_le_bytes(),
            &charges[0].to_le_bytes(),
            &charges[1].to_le_bytes(),
            &suffix,
        ])
        .to_bytes();
        require!(digest == proof.remaining, ProofError::Commitment);
        verify::step(proof, header, row, &accounts.margin, charges)?;
        proof.remaining = suffix;
        proof.cursor += 1;
        Ok(())
    }
    pub fn seal(ctx: &mut Context<Seal>) -> Result<()> {
        let accounts = &mut ctx.accounts;
        accounts.source.resume(&accounts.comparison)?;
        verify::seal(&mut accounts.comparison, &accounts.source.prepared)
    }
}
#[error_code]
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

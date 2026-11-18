//! Isolated local diagnostic. Its PDA contains a synthetic frozen book and a
//! restartable selection result. It has no clearing account or custody authority.
use anchor_lang::prelude::*;
pub mod selection;
use selection::{Plan, PARTITIONS};

declare_id!("sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi");

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct Proof {
    pub venue: Address,
    pub episode: u64,
    pub budget: u16,
    pub cash: u16,
    pub gains: [u16; 6],
    pub order: [u8; 6],
    pub preferred_debtor: u8,
    pub cursor: u8,
    pub sealed: bool,
    pub bump: u8,
    pub best: Plan,
}

#[derive(Accounts)]
#[instruction(episode:u64)]
pub struct Prepare {
    #[account(mut)]
    pub payer: Signer,
    #[account(init, payer=payer, space=8+Proof::INIT_SPACE,
        seeds=[b"default-proof".as_ref(),payer.address().as_ref(),&episode.to_le_bytes()],bump)]
    pub proof: BorshAccount<Proof>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct ContinueProof {
    #[account(mut,seeds=[b"default-proof".as_ref(),proof.venue.as_ref(),&proof.episode.to_le_bytes()],bump=proof.bump)]
    pub proof: BorshAccount<Proof>,
}

#[program]
pub mod default_proof_probe {
    use super::*;

    pub fn prepare(
        ctx: &mut Context<Prepare>,
        episode: u64,
        budget: u16,
        cash: u16,
        gains: [u16; 6],
    ) -> Result<()> {
        require!(
            selection::valid_book(budget, &gains, cash),
            ProofError::UnsupportedBook
        );
        let proof = &mut ctx.accounts.proof;
        proof.venue = *ctx.accounts.payer.address();
        proof.episode = episode;
        proof.budget = budget;
        proof.cash = cash;
        proof.gains = gains;
        (proof.order, proof.preferred_debtor) =
            selection::priorities(proof.venue.as_ref(), episode);
        proof.bump = ctx.bumps.proof;
        Ok(())
    }

    pub fn advance(ctx: &mut Context<ContinueProof>, expected: u8, count: u8) -> Result<()> {
        let proof = &mut ctx.accounts.proof;
        require!(
            !proof.sealed && expected == proof.cursor,
            ProofError::WrongCursor
        );
        require!(
            count > 0 && count <= PARTITIONS - expected,
            ProofError::InvalidCount
        );
        let weights = selection::score_weights(&proof.gains);
        for partition in expected..expected + count {
            let next = selection::candidate(
                partition,
                proof.budget,
                &proof.gains,
                &weights,
                &proof.order,
                proof.preferred_debtor,
            );
            if next.beats(&proof.best, &proof.order, proof.preferred_debtor) {
                proof.best = next;
            }
        }
        proof.cursor += count;
        Ok(())
    }

    pub fn seal(ctx: &mut Context<ContinueProof>) -> Result<()> {
        let proof = &mut ctx.accounts.proof;
        require!(
            !proof.sealed && proof.cursor == PARTITIONS,
            ProofError::Incomplete
        );
        proof.sealed = true;
        Ok(())
    }
}

#[error_code]
pub enum ProofError {
    UnsupportedBook,
    WrongCursor,
    InvalidCount,
    Incomplete,
}

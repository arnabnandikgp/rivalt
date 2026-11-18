//! Isolated local diagnostic. Its PDA contains a synthetic frozen book and a
//! restartable selection result. It has no clearing account or custody authority.
use anchor_lang::prelude::*;
mod basis;
use basis::*;
use default_plan_selection as selection;
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
    pub charges: [u16; 6],
    pub debtor_mask: u8,
    pub recovered: u32,
    pub sharing_cost: u128,
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

    pub fn start_basis(ctx: &mut Context<StartBasis>) -> Result<()> {
        ctx.accounts.basis.numerator = 101u64.to_le_bytes().to_vec();
        Ok(())
    }

    pub fn cycle_basis(ctx: &mut Context<UpdateBasis>, expected: u8, count: u8) -> Result<()> {
        basis::cycle(ctx, expected, count)
    }

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
        let mut best = Plan {
            charges: proof.charges,
            debtor_mask: proof.debtor_mask,
            recovered: proof.recovered,
            sharing_cost: proof.sharing_cost,
        };
        for partition in expected..expected + count {
            let next = selection::candidate(
                partition,
                proof.budget,
                &proof.gains,
                &weights,
                &proof.order,
                proof.preferred_debtor,
            );
            if next.beats(&best, &proof.order, proof.preferred_debtor) {
                best = next;
            }
        }
        proof.charges = best.charges;
        proof.debtor_mask = best.debtor_mask;
        proof.recovered = best.recovered;
        proof.sharing_cost = best.sharing_cost;
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
    StorageFunding,
}

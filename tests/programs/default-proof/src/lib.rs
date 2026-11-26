//! Isolated local diagnostic. Its PDA contains a synthetic frozen book and a
//! restartable selection result. It has no clearing account or custody authority.
use anchor_lang::prelude::*;
mod basis;
mod coverage;
use coverage::*;
mod mirror;
mod withdrawal;
mod slot_custody;
mod slot_trading;
use slot_trading::*;
use slot_custody::*;
use withdrawal::*;
use basis::*;
use default_plan_selection as selection;
use mirror::*;
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

    pub fn open_trade_root(ctx: &mut Context<OpenTradeRoot>, isolated: u16) -> Result<()> {
        slot_trading::open_root(ctx, isolated)
    }
    pub fn open_trade_market(ctx: &mut Context<OpenTradeMarket>, id: u16) -> Result<()> {
        slot_trading::open_market(ctx, id)
    }
    pub fn publish_trade_market(ctx: &mut Context<PublishTradeMarket>, revision: u64, price: u64, funding_atoms: i64) -> Result<()> {
        slot_trading::publish(ctx, revision, price, funding_atoms)
    }
    pub fn deposit_trade_cash(ctx: &mut Context<TradeWallet>, revision: u64, amount: u64) -> Result<()> {
        slot_trading::wallet(ctx, revision, amount, false)
    }
    pub fn withdraw_trade_cash(ctx: &mut Context<TradeWallet>, revision: u64, amount: u64) -> Result<()> {
        slot_trading::wallet(ctx, revision, amount, true)
    }
    pub fn place_trade_order(ctx: &mut Context<TraderOrder>, revision: u64, terms: OrderTerms) -> Result<()> {
        slot_trading::place(ctx, revision, terms)
    }
    pub fn cancel_trade_order(ctx: &mut Context<TraderOrder>, revision: u64) -> Result<()> {
        slot_trading::cancel(ctx, revision)
    }
    pub fn fill_trade_order(ctx: &mut Context<MatchTrade>, trader_revision: u64, maker_revision: u64, price_revision: u64, lots: u64) -> Result<()> {
        slot_trading::execute(ctx, trader_revision, maker_revision, price_revision, lots)
    }

    pub fn transfer_trade_risk(ctx: &mut Context<TransferRisk>, target_revision: u64, receiver_revision: u64,
        price_revision: u64, lots: u64, price: u64) -> Result<TransferOutcome> {
        slot_trading::transfer(ctx, target_revision, receiver_revision, price_revision, lots, price)
    }

    pub fn open_slot_custody(ctx: &mut Context<OpenSlotCustody>) -> Result<()> {
        slot_custody::open(ctx)
    }
    pub fn create_slot_market(ctx: &mut Context<CreateSlotMarket>, market: u16) -> Result<()> {
        slot_custody::market(ctx, market)
    }
    pub fn create_slot_margin(ctx: &mut Context<CreateSlotMargin>, width: u8, child: u8) -> Result<()> {
        slot_custody::prepare(ctx, width, child)
    }
    pub fn fund_slot_margin(ctx: &mut Context<SlotWallet>, revision: u64, amount: u64) -> Result<()> {
        slot_custody::fund(ctx, revision, amount)
    }
    pub fn withdraw_slot_cash(ctx: &mut Context<SlotWallet>, revision: u64, amount: u64) -> Result<()> {
        slot_custody::withdraw(ctx, revision, amount)
    }
    pub fn transfer_slot_cash(ctx: &mut Context<SlotTransfer>, revision: u64, amount: u64) -> Result<()> {
        slot_custody::transfer(ctx, revision, amount)
    }

    pub fn prepare_width_book(ctx: &mut Context<PrepareWidthBook>, width: u8) -> Result<()> {
        withdrawal::prepare_book(ctx, width)
    }

    pub fn prepare_width_window(ctx: &mut Context<PrepareWidthWindow>, ordinal: u8) -> Result<()> {
        withdrawal::prepare_window(ctx, ordinal)
    }

    pub fn check_width_exit(ctx: &mut Context<CheckWidthExit>, amount: u64) -> Result<u64> {
        withdrawal::assess(ctx, amount)
    }

    pub fn prepare_coverage(ctx: &mut Context<PrepareCoverage>, lane: u8) -> Result<()> {
        coverage::prepare(ctx, lane)
    }

    pub fn change_coverage(ctx: &mut Context<ChangeCoverage>, reduce: bool) -> Result<()> {
        coverage::change(ctx, reduce)
    }

    pub fn read_coverage(ctx: &mut Context<ReadCoverage>, mask: u8) -> Result<u32> {
        coverage::measure(ctx, mask)
    }

    pub fn start_mirror(
        ctx: &mut Context<StartMirror>,
        episode: u64,
        commitment: [u8; 32],
    ) -> Result<()> {
        let probe = &mut ctx.accounts.probe;
        probe.venue = *ctx.accounts.payer.address();
        probe.episode = episode;
        probe.commitment = commitment;
        Ok(())
    }

    pub fn write_mirror(ctx: &mut Context<WriteMirror>, offset: u16, bytes: Vec<u8>) -> Result<()> {
        mirror::append(&mut ctx.accounts.probe, offset, &bytes)
    }

    pub fn decide_mirror(
        ctx: &mut Context<DecideMirror>,
        permutation: [u8; 8],
        proposed: u8,
    ) -> Result<()> {
        mirror::decide(&mut ctx.accounts.probe, permutation, proposed)
    }

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
    WrongMirrorWinner,
    CoverageDebt,
    WithdrawalHealth,
    CustodyBinding,
    TradeTerms,
    TradeHealth,
    HealthyTarget,
    NoLiquidationProgress,
    ReceiverHealth,
}

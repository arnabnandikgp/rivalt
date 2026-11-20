//! An independent proposal for one market's episode-ordered forced reductions.
//! Only proposal accounts change while clearing establishes the pair schedule.
use super::{
    recovery::{__client_accounts_recoverysource, __cpi_accounts_recoverysource, RecoverySource},
    winner_allocation::WinnerAllocationProof,
    *,
};

/// Canonical positive entry in a sparse, episode-ordered market book.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType, PartialEq, Eq,
)]
pub struct PairBookEntry {
    pub ordinal: u64,
    pub member_id: u64,
    pub lots: i64,
    pub rate: [u64; 2],
    pub atoms: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct PairBookRow {
    pub original: PairBookEntry,
    pub atoms_left: u64,
    pub lots_left: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, IdlType)]
pub struct PairMemberOpening {
    pub weight: u64,
    pub charge: u64,
    pub book_slot: u64,
    pub lookup: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct PairOrderPage {
    pub certificate: Address,
    pub role: u8,
    pub index: u64,
    pub row_count: u8,
    pub rows: [PairBookRow; 8],
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct PairScheduleProof {
    pub prepared: Address,
    pub allocation: Address,
    pub epoch: u64,
    pub attempt: u64,
    pub market: u8,
    pub stage: u8,
    pub revision: u64,
    pub total_atoms: u128,
    pub minimum_lots: u128,
    pub order_hash: [u8; 32],
    pub target_hash: [u8; 32],
    pub pair_hash: [u8; 32],
    pub rows: [u64; 2],
    pub amounts: [u128; 2],
    pub last_priority: [u8; 32],
    pub last_member: u64,
    pub fastest: u64,
    pub members_left: u64,
    pub floor: [u128; 2],
    pub lots_left: u128,
    pub winner_cursor: u64,
    pub debtor_page: u64,
    pub first_unpaid_page: u64,
    pub pairs: u64,
    pub paired_atoms: u128,
}

#[derive(Accounts)]
#[instruction(nonce:u64)]
pub struct OpenPairSchedule {
    #[account(mut)]
    pub payer: Signer,
    #[account(init,payer=payer,space=8+PairScheduleProof::INIT_SPACE,
        seeds=[b"pair-schedule",payer.address().as_ref(),&nonce.to_le_bytes()],bump)]
    pub certificate: Box<BorshAccount<PairScheduleProof>>,
    pub allocation: Box<BorshAccount<WinnerAllocationProof>>,
    pub source: Nested<RecoverySource>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
#[instruction(role:u8,index:u64)]
pub struct AppendPairOrder {
    #[account(mut)]
    pub payer: Signer,
    #[account(mut)]
    pub certificate: Box<BorshAccount<PairScheduleProof>>,
    #[account(init,payer=payer,space=8+PairOrderPage::INIT_SPACE,
        seeds=[b"pair-order",certificate.address().as_ref(),&[role],&index.to_le_bytes()],bump)]
    pub order_page: Box<BorshAccount<PairOrderPage>>,
    pub source: Nested<RecoverySource>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct CheckPairMembers {
    #[account(mut)]
    pub certificate: Box<BorshAccount<PairScheduleProof>>,
    pub source: Nested<RecoverySource>,
    pub frozen_page: Box<BorshAccount<FrozenMarginPage>>,
}

#[derive(Accounts)]
pub struct MatchPairPage {
    #[account(mut)]
    pub certificate: Box<BorshAccount<PairScheduleProof>>,
    pub source: Nested<RecoverySource>,
    #[account(mut)]
    pub winners: Box<BorshAccount<PairOrderPage>>,
    #[account(mut)]
    pub debtors: Box<BorshAccount<PairOrderPage>>,
}

#[cfg(feature = "populated-recovery-qualification")]
mod matching;
#[cfg(feature = "populated-recovery-qualification")]
mod verify;
#[cfg(feature = "populated-recovery-qualification")]
pub use matching::match_page;
#[cfg(feature = "populated-recovery-qualification")]
pub use verify::{append, check_members, open};

//! Constant-size, proposal-specific proof of a market's ordered winner totals.
use super::{
    recovery::{__client_accounts_recoverysource, __cpi_accounts_recoverysource, RecoverySource},
    *,
};

#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Clone, Copy, Default, PartialEq, Eq,
)]
pub struct WinnerCutoff {
    pub unit: u64,
    pub capacity: u64,
    pub member_id: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Clone, Copy, Default)]
pub struct WinnerMarginal {
    pub cutoff: WinnerCutoff,
    pub extra_lots: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Clone, Copy, Default)]
pub struct WinnerRange {
    pub last_selected: WinnerMarginal,
    pub first_remaining: WinnerMarginal,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Clone, Copy, Default)]
pub struct WinnerSide {
    pub total: u64,
    pub smallest: u64,
    pub largest: u64,
    pub fastest: u64,
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct WinnerAllocationProof {
    pub prepared: Address,
    pub epoch: u64,
    pub original_attempt: u64,
    pub market: u8,
    pub stage: u8,
    pub revision: u64,
    pub cursor: u64,
    pub cutoffs: [WinnerCutoff; 2],
    pub sides: [WinnerSide; 2],
    pub episode: [WinnerRange; 2],
    pub lots: [WinnerRange; 2],
    pub target_digest: [u8; 32],
    pub recovered: [u128; 2],
    pub winner_lots: u128,
    pub debtor_lots: u128,
    pub minimum_lots: u128,
    pub winner_floor_proved: bool,
    pub scanning_opponents: bool,
    pub opponent_cursor: u64,
    pub opponent_lots: u64,
}

#[derive(Accounts)]
#[instruction(nonce:u64)]
pub struct OpenWinnerProof {
    #[account(mut)]
    pub payer: Signer,
    #[account(init,payer=payer,space=8+WinnerAllocationProof::INIT_SPACE,
        seeds=[b"winner-proof",payer.address().as_ref(),&nonce.to_le_bytes()],bump)]
    pub proof: Box<BorshAccount<WinnerAllocationProof>>,
    pub source: Nested<RecoverySource>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct AdvanceWinnerProof {
    #[account(mut)]
    pub proof: Box<BorshAccount<WinnerAllocationProof>>,
    pub source: Nested<RecoverySource>,
    pub page: Box<BorshAccount<FrozenMarginPage>>,
    pub opponents: Option<Box<BorshAccount<FrozenMarginPage>>>,
}

#[cfg(feature = "populated-recovery-qualification")]
pub mod scan;

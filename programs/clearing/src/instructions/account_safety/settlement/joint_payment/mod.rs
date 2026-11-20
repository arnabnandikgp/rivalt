//! Verify both markets' payment rates and each creditor's protection while the
//! financial accounts remain frozen. Any payer may fund a separate proposal.
use super::{
    ordered_pairs::PairScheduleProof,
    recovery::{__client_accounts_recoverysource, __cpi_accounts_recoverysource, RecoverySource},
    winner_allocation::WinnerAllocationProof,
    *,
};

#[derive(AnchorSerialize, AnchorDeserialize, IdlType, Clone, Default)]
pub struct PaymentProposal {
    pub factor: [u64; 5],
    pub rates: [Vec<u64>; 2],
}

#[derive(AnchorSerialize, AnchorDeserialize, IdlType, Clone, Copy)]
pub struct JointMemberOpening {
    pub weights: [u64; 2],
    pub charges: [u64; 2],
}

#[account(borsh)]
#[derive(Default)]
pub struct JointPaymentProof {
    pub prepared: Address,
    pub epoch: u64,
    pub attempt: u64,
    pub revision: u64,
    pub stage: u8,
    pub pair_certificates: [Address; 2],
    pub charges: [u128; 2],
    pub target_hashes: [[u8; 32]; 2],
    pub members_left: u64,
    pub original: PaymentProposal,
    pub original_spent: [u64; 2],
    pub common_register: u32,
    pub common: Vec<u64>,
    pub proposals: Vec<PaymentProposal>,
    pub round: u8,
    pub row_cursor: u64,
    pub spent: [u64; 2],
    pub checkpoints: RateCheckpoints,
    pub width: u16,
    pub registers: Vec<u64>,
}

#[account(borsh)]
#[derive(Default, InitSpace)]
pub struct JointPaymentPage {
    pub payment: Address,
    pub index: u64,
    pub count: u8,
    pub deltas: [[i64; 2]; 8],
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(nonce:u64, account_bytes:u16)]
pub struct OpenJointPayment {
    #[account(mut)]
    pub payer: Signer,
    #[account(init,payer=payer,space=usize::from(account_bytes),
        seeds=[b"joint-payment",payer.address().as_ref(),&nonce.to_le_bytes()],bump)]
    pub payment: Box<BorshAccount<JointPaymentProof>>,
    pub source: Nested<RecoverySource>,
    pub rates: Box<BorshAccount<SettlementRates>>,
    pub btc_pairs: Box<BorshAccount<PairScheduleProof>>,
    pub eth_pairs: Box<BorshAccount<PairScheduleProof>>,
    pub btc_allocation: Box<BorshAccount<WinnerAllocationProof>>,
    pub eth_allocation: Box<BorshAccount<WinnerAllocationProof>>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
#[instruction(index:u64)]
pub struct CaptureJointPayment {
    #[account(mut)]
    pub payer: Signer,
    #[account(mut)]
    pub payment: Box<BorshAccount<JointPaymentProof>>,
    #[account(init,payer=payer,space=8+JointPaymentPage::INIT_SPACE,
        seeds=[b"joint-payment-page",payment.address().as_ref(),&index.to_le_bytes()],bump)]
    pub delta_page: Box<BorshAccount<JointPaymentPage>>,
    pub source: Nested<RecoverySource>,
    pub frozen_page: Box<BorshAccount<FrozenMarginPage>>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct AdvanceJointPayment {
    #[account(mut)]
    pub payment: Box<BorshAccount<JointPaymentProof>>,
    pub source: Nested<RecoverySource>,
    pub frozen_page: Box<BorshAccount<FrozenMarginPage>>,
    pub delta_page: Box<BorshAccount<JointPaymentPage>>,
}

#[cfg(feature = "populated-recovery-qualification")]
pub(super) mod admission;
#[cfg(feature = "populated-recovery-qualification")]
mod rates;
#[cfg(feature = "populated-recovery-qualification")]
pub use admission::{capture, open};
#[cfg(feature = "populated-recovery-qualification")]
pub use rates::advance;

#[cfg(feature="populated-recovery-qualification")]
pub mod binding;

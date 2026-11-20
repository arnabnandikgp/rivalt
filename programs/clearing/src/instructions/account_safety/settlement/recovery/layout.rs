//! Wire types shared by clearing and its read-only qualification program.
use super::*;

#[derive(Accounts)]
pub struct RecoverySource {
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    pub resolution: Box<BorshAccount<Resolution>>,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Default, Clone, Copy)]
pub struct StoredRatio {
    pub(super) numerator: i128,
    pub(super) denominator: u128,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Default, Clone, Copy)]
pub struct Priorities {
    pub(super) fractions: [StoredRatio; 2],
    pub(super) deviation: [StoredRatio; 2],
    pub(super) costs: [[u128; 2]; 2],
}
#[cfg(not(feature = "paged-recovery-qualification"))]
pub(super) const MEMBERS: usize = 8;
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType)]
pub struct SearchMember {
    pub id: u64,
    pub cash: u64,
    pub claims: [i128; 2],
    pub lots: [i64; 2],
    #[cfg(not(feature = "paged-recovery-qualification"))]
    pub histories: [[u8; 256]; 2],
    #[cfg(feature = "paged-recovery-qualification")]
    #[max_len(256)]
    pub histories: [Vec<u8>; 2],
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Clone, Copy)]
pub struct SearchEdge {
    pub market: u8,
    pub debtor: u64,
    pub winner: u64,
    pub maximum: u64,
}
#[cfg(not(feature = "paged-recovery-qualification"))]
mod fixed_book {
    use super::*;
    #[derive(AnchorSerialize, AnchorDeserialize, IdlType, InitSpace, Default, Clone, Copy)]
    pub struct RateWitness {
        // The measured book has one insurance round in each state. The core
        // still verifies clipping and rejects an insufficient proposal sequence.
        pub rates: [u64; 3],
        pub orders: [[u8; 8]; 2],
    }

    #[account(borsh)]
    #[derive(InitSpace)]
    pub struct RecoverySearch {
        pub prepared: Address,
        pub epoch: u64,
        pub revision: u64,
        pub proposed: u128,
        pub count: u128,
        pub cursor: u128,
        pub stage: u8,
        pub score_num: i128,
        pub score_den: u128,
        pub cash: [u64; 8],
        pub movements: [[i64; 2]; MEMBERS],
        pub remaining_insurance: [u64; 2],
        pub retained_fees: [u64; 2],
        pub original: RateWitness,
        #[max_len(8)]
        pub rows: Vec<SearchMember>,
        // Two markets times eight possible debtors times seven other members.
        #[max_len(112)]
        pub edges: Vec<SearchEdge>,
        pub budgets: [[u64; 2]; MEMBERS],
        pub weights: [[u64; 2]; MEMBERS],
        pub priority: Priorities,
    }
    pub(super) const SEARCH_ACCOUNT_BYTES: usize = 8 + RecoverySearch::INIT_SPACE;
}
#[cfg(not(feature = "paged-recovery-qualification"))]
use fixed_book::SEARCH_ACCOUNT_BYTES;
#[cfg(not(feature = "paged-recovery-qualification"))]
pub use fixed_book::{RateWitness, RecoverySearch};

#[cfg(feature = "paged-recovery-qualification")]
mod paged_book {
    use super::*;
    #[derive(AnchorSerialize, AnchorDeserialize, IdlType, Default, Clone)]
    pub struct RateWitness {
        pub rates: Vec<[u64; 3]>,
        pub orders: [Vec<u8>; 2],
    }
    #[account(borsh)]
    pub struct PagedRecoverySearch {
        pub prepared: Address,
        pub epoch: u64,
        pub revision: u64,
        pub proposed: u128,
        pub count: u128,
        pub cursor: u128,
        pub stage: u8,
        pub score_num: i128,
        pub score_den: u128,
        pub cash: Vec<u64>,
        pub movements: Vec<[i64; 2]>,
        pub remaining_insurance: [u64; 2],
        pub retained_fees: [u64; 2],
        pub original: RateWitness,
        pub rows: Vec<SearchMember>,
        pub edges: Vec<SearchEdge>,
        pub budgets: Vec<[u64; 2]>,
        pub weights: Vec<[u64; 2]>,
        pub priority: Priorities,
    }
    // Maximum allocation in the system-program CPI used to initialize this local account.
    pub(super) const SEARCH_ACCOUNT_BYTES: usize = 10_240;
}
#[cfg(feature = "paged-recovery-qualification")]
use paged_book::SEARCH_ACCOUNT_BYTES;
#[cfg(feature = "paged-recovery-qualification")]
pub use paged_book::{PagedRecoverySearch as RecoverySearch, RateWitness};

#[derive(Accounts)]
#[instruction(nonce:u64)]
pub struct OpenSearch {
    #[account(mut)]
    pub payer: Signer,
    #[account(init,payer=payer,space=SEARCH_ACCOUNT_BYTES,seeds=[b"search",payer.address().as_ref(),&nonce.to_le_bytes()],bump)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<RecoverySource>,
    pub system_program: Program<System>,
}
#[derive(Accounts)]
pub struct CaptureSearch {
    #[account(mut)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<RecoverySource>,
    pub page: Box<BorshAccount<FrozenMarginPage>>,
    pub margin: Box<BorshAccount<MarginAccount>>,
}
#[derive(Accounts)]
pub struct AdvanceSearch {
    #[account(mut)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<RecoverySource>,
}

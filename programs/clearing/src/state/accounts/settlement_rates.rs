//! Verification-only proposal state, separate from custody and the frozen input.
use super::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, IdlType)]
pub struct RateCheckpoints {
    pub insurance: [u8; 64],
    pub work: [u8; 960],
}
impl Default for RateCheckpoints {
    fn default() -> Self {
        Self {
            insurance: [0; 64],
            work: [0; 960],
        }
    }
}
#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct SettlementRates {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub epoch: u64,
    pub attempt: u64,
    pub stage: u8,
    pub proposer: Address,
    pub last_progress_slot: u64,
    pub factor: [u64; 5],
    pub lengths: [u64; 2],
    pub uploaded: [u64; 2],
    pub state: RateCheckpoints,
    pub bump: u8,
}

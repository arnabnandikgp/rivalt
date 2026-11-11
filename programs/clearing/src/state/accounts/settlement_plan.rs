//! Program-owned conserving plan. Verification never grants a keeper authority
//! to upload final cash, graph edges, or arithmetic checkpoints.
use super::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, IdlType)]
pub struct PlanCheckpoint {
    pub bytes: [u8; 960],
}
impl Default for PlanCheckpoint {
    fn default() -> Self {
        Self { bytes: [0; 960] }
    }
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct SettlementPlan {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub epoch: u64,
    pub rates_revision: u64,
    pub rates_attempt: u64,
    pub stage: u8,
    pub cursor: u64,
    pub proposer: Address,
    pub last_progress_slot: u64,
    pub order_attempt: u64,
    pub order_market: u8,
    pub insurance_spent: [u64; 2],
    pub graph_length: u64,
    pub graph_required: u64,
    pub original_cash_remaining: u64,
    pub cash_applied: u64,
    pub market_movements: [i128; 2],
    pub adoption_revision: u64,
    pub work: PlanCheckpoint,
    pub bump: u8,
}

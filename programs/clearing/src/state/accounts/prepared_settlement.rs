//! Paged verification work. The initial source is an existing frozen schema-8
//! cohort; completion never grants Apply authority or expands financial admission.
use super::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, IdlType)]
pub struct PreparationState {
    pub membership: [u8; 544],
    pub valuation: [u8; 288],
    pub denominator: [u8; 320],
}
impl Default for PreparationState {
    fn default() -> Self {
        Self {
            membership: [0; 544],
            valuation: [0; 288],
            denominator: [0; 320],
        }
    }
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct PreparedSettlement {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub epoch: u64,
    pub source: Address,
    pub source_revision: u64,
    pub registry_revision: u64,
    pub membership_epoch: u64,
    pub registry_hash: [u8; 32],
    pub count: u64,
    pub safety_epoch: u64,
    pub terms_epoch: u64,
    pub config_epochs: [u64; 2],
    pub prices: [u64; 2],
    pub funding: [i128; 2],
    pub allocated: u64,
    pub pools: [u64; 2],
    pub insurance: [u64; 2],
    pub fees: [u64; 2],
    pub gross: [u64; 2],
    pub stage: u8,
    /// Qualification bridge only: immutable copies of the existing <=64 roots.
    pub index_initialized: u16,
    pub member_page_initialized: bool,
    pub state: PreparationState,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct FrozenMargin {
    pub id: u64,
    pub member: Address,
    pub activation_generation: u64,
    pub original_revision: u64,
    pub cash: u64,
    pub lots: [i64; 2],
    pub generations: [u64; 2],
    pub claims: [i128; 2],
    pub collected: u64,
}
#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct FrozenMarginPage {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub epoch: u64,
    pub page_index: u64,
    pub row_count: u8,
    pub rows: [FrozenMargin; 8],
    pub bump: u8,
}

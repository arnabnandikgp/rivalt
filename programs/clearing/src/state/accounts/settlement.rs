//! Reserved successor scratch account. The P54B verifier initializes/consumes
//! it; schema-8 financial activation is unchanged.
use anchor_lang::prelude::*;

pub const SETTLEMENT_SCHEMA: u16 = super::SCHEMA_VERSION;
pub const LIMB_PAGE_WORDS: usize = financial_core::clearing::scalable::pages::PAGE_WORDS as usize;
pub const LIMB_WORDS_OFFSET: usize = 81;
pub const LIMB_PAGE_BYTES: usize = LIMB_WORDS_OFFSET + 8 * LIMB_PAGE_WORDS;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, IdlType)]
pub struct LimbPayload {
    pub words: Box<[u64; LIMB_PAGE_WORDS]>,
}
impl Space for LimbPayload {
    const INIT_SPACE: usize = 8 * LIMB_PAGE_WORDS;
}
impl Default for LimbPayload {
    fn default() -> Self {
        Self {
            words: Box::new([0; LIMB_PAGE_WORDS]),
        }
    }
}

/// The fixed prefix is independently checked before direct word access. The
/// attempt tag fences reused allocation; epoch remains part of the PDA seeds.
/// Revision is internal scratch progress, not a trader signing nonce.
#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct SettlementLimbPage {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub epoch: u64,
    pub attempt: u64,
    pub register: u32,
    pub page_index: u64,
    /// Addressable words in this allocation's last page, otherwise 256.
    pub word_count: u16,
    pub bump: u8,
    pub payload: LimbPayload,
}

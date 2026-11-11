//! Reserved read interfaces for the schema-9 financial index. P55 owns lifecycle
//! mutation and storage funding; no current instruction creates these accounts.
use anchor_lang::prelude::*;

pub const MEMBER_PAGE_ENTRIES: usize = 64;
pub const MEMBER_REGISTERED: u8 = 1;
pub const MEMBER_FINANCIAL: u8 = 2;
pub const MEMBER_RETIRED: u8 = 3;
pub const MEMBER_INDEX_BYTES: usize = 190;
pub const MEMBER_PAGE_BYTES: usize = 2699;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct MemberEntry {
    pub root: Address,
    pub lifecycle: u8,
    pub activation_generation: u64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, IdlType)]
pub struct MemberEntries {
    pub entries: Box<[MemberEntry; MEMBER_PAGE_ENTRIES]>,
}
impl Space for MemberEntries {
    const INIT_SPACE: usize = 41 * MEMBER_PAGE_ENTRIES;
}
impl Default for MemberEntries {
    fn default() -> Self {
        Self {
            entries: Box::new([MemberEntry::default(); MEMBER_PAGE_ENTRIES]),
        }
    }
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct MemberPage {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub page_index: u64,
    pub allocated_mask: u64,
    pub financial_mask: u64,
    pub members: MemberEntries,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct MemberIndexNode {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    /// Zero points to member pages; 14 is the root for a u64 ID namespace.
    pub level: u8,
    pub prefix: u64,
    pub populated_mask: u16,
    /// Number of Financial roots, not number of populated pages.
    pub counts: [u64; 16],
    pub bump: u8,
}

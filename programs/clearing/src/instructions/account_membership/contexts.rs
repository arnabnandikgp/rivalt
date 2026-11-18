use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;
use crate::manual_account::ManualAccount;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeRecoveryStorage {
    #[account(mut)]
    pub authority: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump,has_one=authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init,payer=authority,space=8+RecoveryStorage::INIT_SPACE,
        seeds=[b"recovery-storage",venue.address().as_ref()],bump)]
    pub storage: Box<BorshAccount<RecoveryStorage>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ConfigureRecoveryStorage {
    pub authority: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump,has_one=authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut,seeds=[b"recovery-storage",venue.address().as_ref()],bump=storage.bump,has_one=venue)]
    pub storage: Box<BorshAccount<RecoveryStorage>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct FundRecoveryAllocation {
    #[account(mut)]
    pub payer: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds=[b"recovery-storage",venue.address().as_ref()],bump=storage.bump,has_one=venue)]
    pub storage: Box<BorshAccount<RecoveryStorage>>,
    /// CHECK: the handler creates exactly this canonical system-owned empty PDA,
    /// binds it to the pending capacity schedule, and records the actual payer's
    /// contribution. Existing donated lamports cannot block initialization.
    #[account(mut)]
    pub allocation: UncheckedAccount,
    #[account(init,payer=payer,space=8+StorageFunding::INIT_SPACE,
        seeds=[b"storage-funding",venue.address().as_ref(),allocation.address().as_ref()],bump)]
    pub receipt: Box<BorshAccount<StorageFunding>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct VerifyRecoveryAllocation {
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut,seeds=[b"recovery-storage",venue.address().as_ref()],bump=storage.bump,has_one=venue)]
    pub storage: Box<BorshAccount<RecoveryStorage>>,
    /// CHECK: exact expected kind/PDA/schema/rent/epoch/prefix checked by the
    /// bounded physical-storage verifier, never selected by an uploaded key.
    pub allocation: UncheckedAccount,
    #[account(seeds=[b"storage-funding",venue.address().as_ref(),allocation.address().as_ref()],bump=receipt.bump,
        has_one=venue,constraint=receipt.allocation==*allocation.address() @ ClearingError::Resolution)]
    pub receipt: Box<BorshAccount<StorageFunding>>,
}

/// Permissionless rent funding only: a newly allocated page/node contains no
/// identities or Financial members. Lifecycle authority remains owner-controlled.
#[event_cpi]
#[derive(Accounts)]
pub struct FundMemberPage {
    #[account(mut)]
    pub payer: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    /// CHECK: canonical page/node PDA and zero system allocation checked before
    /// signed allocation; scoped history authenticates the resulting exact type.
    #[account(mut)]
    pub allocation: UncheckedAccount,
    #[account(init,payer=payer,space=8+StorageFunding::INIT_SPACE,
        seeds=[b"storage-funding",venue.address().as_ref(),allocation.address().as_ref()],bump)]
    pub receipt: Box<BorshAccount<StorageFunding>>,
    pub system_program: Program<System>,
}

/// Permissionless rent funding only: a newly allocated page/node contains no
/// identities or Financial members. Lifecycle authority remains owner-controlled.
#[event_cpi]
#[derive(Accounts)]
pub struct FundMemberIndex {
    #[account(mut)]
    pub payer: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    /// CHECK: canonical page/node PDA and zero system allocation checked before
    /// signed allocation; scoped history authenticates the resulting exact type.
    #[account(mut)]
    pub allocation: ManualAccount<MemberIndexNode>,
    #[account(init,payer=payer,space=8+StorageFunding::INIT_SPACE,
        seeds=[b"storage-funding",venue.address().as_ref(),allocation.address().as_ref()],bump)]
    pub receipt: Box<BorshAccount<StorageFunding>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ChangeMarginMembership {
    pub owner: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut,seeds=[b"registry-v3",venue.address().as_ref()],bump=registry.bump,has_one=venue)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    #[account(seeds=[b"portfolio-v3",venue.address().as_ref(),owner.address().as_ref(),&portfolio.index.to_le_bytes()],
        bump=portfolio.bump,has_one=venue,has_one=owner)]
    pub portfolio: Box<BorshAccount<Portfolio>>,
    #[account(mut,seeds=[b"margin-v3",portfolio.address().as_ref(),&margin.subaccount_index.to_le_bytes()],
        bump=margin.bump,has_one=venue,has_one=owner,has_one=portfolio)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    #[account(mut,seeds=[b"member-page",venue.address().as_ref(),&members.page_index.to_le_bytes()],bump=members.bump,has_one=venue)]
    pub members: Box<BorshAccount<MemberPage>>,
    #[account(seeds=[b"recovery-storage",venue.address().as_ref()],bump=storage.bump,has_one=venue)]
    pub storage: Box<BorshAccount<RecoveryStorage>>,
    /// CHECK: absence of the canonical capital binding is independently verified;
    /// a disabled or quarantined binding still prevents membership exit.
    pub binding: UncheckedAccount,
    // Exactly fifteen writable canonical MemberIndexNodes in ascending level.
}

#[event_cpi]
#[derive(Accounts)]
pub struct RetireMargin {
    #[account(mut)]
    pub owner: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut,seeds=[b"registry-v3",venue.address().as_ref()],bump=registry.bump,has_one=venue)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    #[account(mut,seeds=[b"portfolio-v3",venue.address().as_ref(),owner.address().as_ref(),&portfolio.index.to_le_bytes()],
        bump=portfolio.bump,has_one=venue,has_one=owner)]
    pub portfolio: Box<BorshAccount<Portfolio>>,
    /// CHECK: handler authenticates MarginAccount owner/PDA/exact layout and
    /// rewrites its same address to MarginTombstone; no typed root writeback.
    #[account(mut)]
    pub margin: ManualAccount<(MarginAccount, MarginTombstone)>,
    #[account(mut,seeds=[b"member-page",venue.address().as_ref(),&members.page_index.to_le_bytes()],bump=members.bump,has_one=venue)]
    pub members: Box<BorshAccount<MemberPage>>,
    /// CHECK: canonical binding must have no owned data before terminal retirement.
    pub binding: UncheckedAccount,
}


#[event_cpi]
#[derive(Accounts)]
pub struct RefundRecoveryAllocation {
    pub authority: Signer,
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump,has_one=authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut,seeds=[b"recovery-storage",venue.address().as_ref()],bump=storage.bump,has_one=venue)]
    pub storage: Box<BorshAccount<RecoveryStorage>>,
    /// CHECK: exact canonical work kind/PDA/epoch/rent verified before shrinking;
    /// the only destination layout is the permanent StorageTombstone.
    #[account(mut)]
    pub allocation: ManualAccount<StorageTombstone>,
    #[account(seeds=[b"storage-funding",venue.address().as_ref(),allocation.address().as_ref()],bump=receipt.bump,
        has_one=venue,constraint=receipt.allocation == *allocation.address() @ ClearingError::Resolution)]
    pub receipt: Box<BorshAccount<StorageFunding>>,
    /// CHECK: lamport credit only, bound to the immutable creation payer.
    /// SAFETY: authority may also be the recorded payer. Both are untyped views;
    /// only rent_payer writes lamports, after all authority checks. The other
    /// mutable accounts retain duplicate guards and cannot alias this destination.
    #[account(mut,unsafe(dup),address=receipt.rent_payer)]
    pub rent_payer: UncheckedAccount,
}

use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;

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

use super::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct ResolutionIdentity {
    #[account(mut, seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = vault)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(mut, seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.address().to_owned() @ ClearingError::Profile)]
    pub btc: Box<BorshAccount<Market>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.address().to_owned() @ ClearingError::Profile)]
    pub eth: Box<BorshAccount<Market>>,
    #[account(mut, seeds = [b"ledger-v3", btc.address().as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == btc.address().to_owned() && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Box<BorshAccount<MarketLedger>>,
    #[account(mut, seeds = [b"ledger-v3", eth.address().as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == eth.address().to_owned() && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Box<BorshAccount<MarketLedger>>,
    #[account(seeds = [b"vault-v3", venue.address().as_ref()], bump = venue.vault_bump,
        constraint = *vault.owner() == venue.address().to_owned() && *vault.mint() == venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeAccountResolution {
    #[account(mut)]
    pub payer: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init, payer = payer, space = 8 + Resolution::INIT_SPACE,
        seeds = [b"resolution-v3", venue.address().as_ref()], bump)]
    pub resolution: Box<BorshAccount<Resolution>>,
    pub system_program: Program<System>,
}



/// Exact bindings are checked even when a feed is stale. Missing credibility is
/// a valuation state, not permission to substitute a caller-supplied price.
#[derive(Accounts)]
pub struct ResolutionSources {
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub primary_btc: UncheckedAccount,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub primary_collateral: UncheckedAccount,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub guard_btc: UncheckedAccount,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub guard_collateral: UncheckedAccount,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub primary_eth: UncheckedAccount,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub guard_eth: UncheckedAccount,
}

#[event_cpi]
#[derive(Accounts)]
pub struct FreezeAccounts {
    pub identity: Nested<ResolutionIdentity>,
    pub caller: Signer,
    #[account(seeds = [b"registry-v3", identity.venue.address().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.address().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub resolution: Box<BorshAccount<Resolution>>,
    #[account(seeds = [b"margin-v3", target.portfolio.as_ref(), &target.subaccount_index.to_le_bytes()], bump = target.bump,
        constraint = target.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub target: Box<BorshAccount<MarginAccount>>,
    #[account(seeds=[b"member-page",identity.venue.address().as_ref(),&members.page_index.to_le_bytes()],
        bump=members.bump,constraint=members.venue == *identity.venue.address() @ ClearingError::Resolution)]
    pub members: Box<BorshAccount<MemberPage>>,
    #[account(mut,seeds=[b"recovery-storage",identity.venue.address().as_ref()],bump=storage.bump,
        constraint=storage.venue == *identity.venue.address() @ ClearingError::Resolution)]
    pub storage: Box<BorshAccount<RecoveryStorage>>,
    pub sources: Nested<ResolutionSources>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ValueAccountResolution {
    pub identity: Nested<ResolutionIdentity>,
    #[account(seeds = [b"registry-v3", identity.venue.address().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.address().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub resolution: Box<BorshAccount<Resolution>>,
    pub sources: Nested<ResolutionSources>,
}





#[event_cpi]
#[derive(Accounts)]
pub struct RecoverAccounts {
    pub identity: Nested<ResolutionIdentity>,
    pub caller: Signer,
    #[account(seeds = [b"registry-v3", identity.venue.address().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.address().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub resolution: Box<BorshAccount<Resolution>>,
    pub sources: Nested<ResolutionSources>,
}

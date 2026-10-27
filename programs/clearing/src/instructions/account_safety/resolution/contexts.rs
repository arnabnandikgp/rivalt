use super::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct ResolutionIdentityV3<'info> {
    #[account(mut, seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = vault)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(mut, seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"ledger-v3", btc.key().as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == btc.key() && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(mut, seeds = [b"ledger-v3", eth.key().as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == eth.key() && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.owner == venue.key() && vault.mint == venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct InitializeAccountResolutionV3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(init, payer = payer, space = 8 + ResolutionV3::INIT_SPACE,
        seeds = [b"resolution-v3", venue.key().as_ref()], bump)]
    pub resolution: Box<Account<'info, ResolutionV3>>,
    #[account(init, payer = payer, space = 8 + ResolutionWorkV3::INIT_SPACE,
        seeds = [b"resolution-work-v3", venue.key().as_ref()], bump)]
    pub work: Box<Account<'info, ResolutionWorkV3>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page_index: u16)]
pub struct InitializeAccountResolutionPageV3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"resolution-v3", venue.key().as_ref()], bump = resolution.bump, has_one = venue)]
    pub resolution: Box<Account<'info, ResolutionV3>>,
    #[account(init, payer = payer, space = 8 + ResolutionPageV3::INIT_SPACE,
        seeds = [b"resolution-page-v3", venue.key().as_ref(), &page_index.to_le_bytes()], bump)]
    pub page: Box<Account<'info, ResolutionPageV3>>,
    pub system_program: Program<'info, System>,
}

/// Exact bindings are checked even when a feed is stale. Missing credibility is
/// a valuation state, not permission to substitute a caller-supplied price.
#[derive(Accounts)]
pub struct ResolutionSourcesV3<'info> {
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub guard_collateral: UncheckedAccount<'info>,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub primary_eth: UncheckedAccount<'info>,
    /// CHECK: configured identity, program owner, feed ID and monotonic sequence.
    pub guard_eth: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct FreezeAccountsV3<'info> {
    pub identity: ResolutionIdentityV3<'info>,
    pub caller: Signer<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, ResolutionV3>>,
    #[account(mut, seeds = [b"resolution-work-v3", identity.venue.key().as_ref()], bump = work.bump,
        constraint = work.venue == identity.venue.key() @ ClearingError::Profile)]
    pub work: Box<Account<'info, ResolutionWorkV3>>,
    #[account(seeds = [b"margin-v3", target.portfolio.as_ref(), &target.subaccount_index.to_le_bytes()], bump = target.bump,
        constraint = target.venue == identity.venue.key() @ ClearingError::Profile)]
    pub target: Box<Account<'info, MarginAccountV3>>,
    pub sources: ResolutionSourcesV3<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ValueAccountResolutionV3<'info> {
    pub identity: ResolutionIdentityV3<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, ResolutionV3>>,
    pub sources: ResolutionSourcesV3<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdvanceAccountResolutionV3<'info> {
    pub identity: ResolutionIdentityV3<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, ResolutionV3>>,
    #[account(mut, seeds = [b"resolution-work-v3", identity.venue.key().as_ref()], bump = work.bump,
        constraint = work.venue == identity.venue.key() @ ClearingError::Profile)]
    pub work: Box<Account<'info, ResolutionWorkV3>>,
    #[account(mut, seeds = [b"resolution-page-v3", identity.venue.key().as_ref(), &page.page_index.to_le_bytes()], bump = page.bump,
        constraint = page.venue == identity.venue.key() @ ClearingError::Profile)]
    pub page: Box<Account<'info, ResolutionPageV3>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ProposeAccountResolutionV3<'info> {
    pub identity: ResolutionIdentityV3<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, ResolutionV3>>,
    #[account(mut, seeds = [b"resolution-work-v3", identity.venue.key().as_ref()], bump = work.bump,
        constraint = work.venue == identity.venue.key() @ ClearingError::Profile)]
    pub work: Box<Account<'info, ResolutionWorkV3>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RecoverAccountsV3<'info> {
    pub identity: ResolutionIdentityV3<'info>,
    pub caller: Signer<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, ResolutionV3>>,
    pub sources: ResolutionSourcesV3<'info>,
}

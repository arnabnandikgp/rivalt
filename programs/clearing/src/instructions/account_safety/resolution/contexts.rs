use super::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct ResolutionIdentity<'info> {
    #[account(mut, seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = vault)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(mut, seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"ledger-v3", btc.key().as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == btc.key() && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Box<Account<'info, MarketLedger>>,
    #[account(mut, seeds = [b"ledger-v3", eth.key().as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == eth.key() && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Box<Account<'info, MarketLedger>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.owner == venue.key() && vault.mint == venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct InitializeAccountResolution<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(init, payer = payer, space = 8 + Resolution::INIT_SPACE,
        seeds = [b"resolution-v3", venue.key().as_ref()], bump)]
    pub resolution: Box<Account<'info, Resolution>>,
    #[account(init, payer = payer, space = 8 + ResolutionWork::INIT_SPACE,
        seeds = [b"resolution-work-v3", venue.key().as_ref()], bump)]
    pub work: Box<Account<'info, ResolutionWork>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page_index: u16)]
pub struct InitializeAccountResolutionPage<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"resolution-v3", venue.key().as_ref()], bump = resolution.bump, has_one = venue)]
    pub resolution: Box<Account<'info, Resolution>>,
    #[account(init, payer = payer, space = 8 + ResolutionPage::INIT_SPACE,
        seeds = [b"resolution-page-v3", venue.key().as_ref(), &page_index.to_le_bytes()], bump)]
    pub page: Box<Account<'info, ResolutionPage>>,
    pub system_program: Program<'info, System>,
}

/// Exact bindings are checked even when a feed is stale. Missing credibility is
/// a valuation state, not permission to substitute a caller-supplied price.
#[derive(Accounts)]
pub struct ResolutionSources<'info> {
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
pub struct FreezeAccounts<'info> {
    pub identity: ResolutionIdentity<'info>,
    pub caller: Signer<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, Resolution>>,
    #[account(mut, seeds = [b"resolution-work-v3", identity.venue.key().as_ref()], bump = work.bump,
        constraint = work.venue == identity.venue.key() @ ClearingError::Profile)]
    pub work: Box<Account<'info, ResolutionWork>>,
    #[account(seeds = [b"margin-v3", target.portfolio.as_ref(), &target.subaccount_index.to_le_bytes()], bump = target.bump,
        constraint = target.venue == identity.venue.key() @ ClearingError::Profile)]
    pub target: Box<Account<'info, MarginAccount>>,
    pub sources: ResolutionSources<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ValueAccountResolution<'info> {
    pub identity: ResolutionIdentity<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, Resolution>>,
    pub sources: ResolutionSources<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdvanceAccountResolution<'info> {
    pub identity: ResolutionIdentity<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, Resolution>>,
    #[account(mut, seeds = [b"resolution-work-v3", identity.venue.key().as_ref()], bump = work.bump,
        constraint = work.venue == identity.venue.key() @ ClearingError::Profile)]
    pub work: Box<Account<'info, ResolutionWork>>,
    #[account(mut, seeds = [b"resolution-page-v3", identity.venue.key().as_ref(), &page.page_index.to_le_bytes()], bump = page.bump,
        constraint = page.venue == identity.venue.key() @ ClearingError::Profile)]
    pub page: Box<Account<'info, ResolutionPage>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ProposeAccountResolution<'info> {
    pub identity: ResolutionIdentity<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, Resolution>>,
    #[account(mut, seeds = [b"resolution-work-v3", identity.venue.key().as_ref()], bump = work.bump,
        constraint = work.venue == identity.venue.key() @ ClearingError::Profile)]
    pub work: Box<Account<'info, ResolutionWork>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RecoverAccounts<'info> {
    pub identity: ResolutionIdentity<'info>,
    pub caller: Signer<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, Resolution>>,
    pub sources: ResolutionSources<'info>,
}

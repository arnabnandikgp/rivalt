use super::*;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeFundingPublisherV4<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.key() @ ClearingError::Profile)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"liquidity-v4", market.key().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<Account<'info, LiquidityRegistryV4>>,
    #[account(init, payer = authority, space = 8 + FundingPublisherV4::INIT_SPACE,
        seeds = [b"funding-publisher-v4", market.key().as_ref()], bump)]
    pub configuration: Box<Account<'info, FundingPublisherV4>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ConfigureFundingPublisherV4<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.key() @ ClearingError::Profile)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"funding-publisher-v4", market.key().as_ref()], bump = configuration.bump,
        has_one = venue, has_one = market)]
    pub configuration: Box<Account<'info, FundingPublisherV4>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PublishFundingReportV4<'info> {
    pub publisher: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.key() @ ClearingError::Profile)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"funding-publisher-v4", market.key().as_ref()], bump = configuration.bump,
        has_one = venue, has_one = market, has_one = publisher)]
    pub configuration: Box<Account<'info, FundingPublisherV4>>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub primary_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub guard_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub guard_collateral: UncheckedAccount<'info>,
}

use super::*;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeFundingPublisher<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.key() @ ClearingError::Profile)]
    pub market: Box<Account<'info, Market>>,
    #[account(seeds = [b"liquidity-v4", market.key().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<Account<'info, LiquidityRegistry>>,
    #[account(init, payer = authority, space = 8 + FundingPublisher::INIT_SPACE,
        seeds = [b"funding-publisher-v4", market.key().as_ref()], bump)]
    pub configuration: Box<Account<'info, FundingPublisher>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ConfigureFundingPublisher<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.key() @ ClearingError::Profile)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"funding-publisher-v4", market.key().as_ref()], bump = configuration.bump,
        has_one = venue, has_one = market)]
    pub configuration: Box<Account<'info, FundingPublisher>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PublishFundingReport<'info> {
    pub publisher: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.key() @ ClearingError::Profile)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"funding-publisher-v4", market.key().as_ref()], bump = configuration.bump,
        has_one = venue, has_one = market, has_one = publisher)]
    pub configuration: Box<Account<'info, FundingPublisher>>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub primary_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub guard_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub guard_collateral: UncheckedAccount<'info>,
}

use super::*;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeFundingPublisher {
    #[account(mut)]
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.address().to_owned() @ ClearingError::Profile)]
    pub market: Box<BorshAccount<Market>>,
    #[account(seeds = [b"liquidity-v4", market.address().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<BorshAccount<LiquidityRegistry>>,
    #[account(init, payer = authority, space = 8 + FundingPublisher::INIT_SPACE,
        seeds = [b"funding-publisher-v4", market.address().as_ref()], bump)]
    pub configuration: Box<BorshAccount<FundingPublisher>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ConfigureFundingPublisher {
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.address().to_owned() @ ClearingError::Profile)]
    pub market: Box<BorshAccount<Market>>,
    #[account(mut, seeds = [b"funding-publisher-v4", market.address().as_ref()], bump = configuration.bump,
        has_one = venue, has_one = market)]
    pub configuration: Box<BorshAccount<FundingPublisher>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PublishFundingReport {
    pub publisher: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.address().to_owned() @ ClearingError::Profile)]
    pub market: Box<BorshAccount<Market>>,
    #[account(mut, seeds = [b"funding-publisher-v4", market.address().as_ref()], bump = configuration.bump,
        has_one = venue, has_one = market, has_one = publisher)]
    pub configuration: Box<BorshAccount<FundingPublisher>>,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub primary_asset: UncheckedAccount,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub primary_collateral: UncheckedAccount,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub guard_asset: UncheckedAccount,
    /// CHECK: fixed source identity, owner, schema and sequence validated below.
    pub guard_collateral: UncheckedAccount,
}

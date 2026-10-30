//! Shared authenticated account identity for canonical route execution.
use super::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct AccountRouteIdentity<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = vault)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 @ ClearingError::Profile)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[other_market.index]], bump = other_market.bump,
        has_one = venue, constraint = other_market.key() != market.key() @ ClearingError::Alias)]
    pub other_market: Option<Box<Account<'info, Market>>>,
    #[account(mut, seeds = [b"ledger-v3", market.key().as_ref()], bump = ledger.bump, has_one = venue, has_one = market)]
    pub ledger: Box<Account<'info, MarketLedger>>,
    #[account(seeds = [b"ledger-v3", venue.markets[1 - market.index as usize].as_ref()], bump = other_ledger.bump, has_one = venue,
        constraint = other_ledger.market == venue.markets[1 - market.index as usize] @ ClearingError::Profile)]
    pub other_ledger: Box<Account<'info, MarketLedger>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.owner == venue.key() && vault.mint == venue.quote_mint @ ClearingError::Reconciliation)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"margin-v3", trader.portfolio.as_ref(), &trader.subaccount_index.to_le_bytes()], bump = trader.bump, has_one = venue)]
    pub trader: Box<Account<'info, MarginAccount>>,
}

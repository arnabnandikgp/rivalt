//! Schema-3 custody contexts: canonical identities and real SPL token authority.
use crate::{error::ClearingError, state::v3::*};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
#[event_cpi]
#[derive(Accounts)]
#[instruction(domain: [u8; 32])]
pub struct InitializeVenueV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint = clearing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::Authority)]
    pub clearing_program: Program<'info, crate::program::Clearing>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ClearingError::Authority)]
    pub program_data: Box<Account<'info, ProgramData>>,
    #[account(constraint = quote_mint.decimals == 6 && quote_mint.freeze_authority.is_none() @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = authority, space = 8 + VenueV3::INIT_SPACE, seeds = [b"venue-v3", domain.as_ref()], bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(init, payer = authority, space = 8 + CustodyV3::INIT_SPACE, seeds = [b"custody-v3", venue.key().as_ref()], bump)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(init, payer = authority, space = 8 + SafetyV3::INIT_SPACE, seeds = [b"safety-v3", venue.key().as_ref()], bump)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(init, payer = authority, seeds = [b"vault-v3", venue.key().as_ref()], bump,
        token::mint = quote_mint, token::authority = venue)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeVenueRegistryV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(init, payer = authority, space = 8 + VenueRegistryV3::INIT_SPACE,
        seeds = [b"registry-v3", venue.key().as_ref()], bump)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct InitializeMarketV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(init, payer = authority, space = 8 + MarketV3::INIT_SPACE,
        seeds = [b"market-v3", venue.key().as_ref(), &[index]], bump)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(init, payer = authority, space = 8 + MarketLedgerV3::INIT_SPACE,
        seeds = [b"ledger-v3", market.key().as_ref()], bump)]
    pub ledger: Box<Account<'info, MarketLedgerV3>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u16)]
pub struct CreatePortfolioV3<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(init, payer = owner, space = 8 + PortfolioV3::INIT_SPACE,
        seeds = [b"portfolio-v3", venue.key().as_ref(), owner.key().as_ref(), &index.to_le_bytes()], bump)]
    pub portfolio: Box<Account<'info, PortfolioV3>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(subaccount_index: u16)]
pub struct RegisterMarginV3<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"registry-v3", venue.key().as_ref()], bump = registry.bump, has_one = venue)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(mut, seeds = [b"portfolio-v3", venue.key().as_ref(), owner.key().as_ref(), &portfolio.index.to_le_bytes()],
        bump = portfolio.bump, has_one = venue, has_one = owner)]
    pub portfolio: Box<Account<'info, PortfolioV3>>,
    #[account(init, payer = owner, space = 8 + MarginAccountV3::INIT_SPACE,
        seeds = [b"margin-v3", portfolio.key().as_ref(), &subaccount_index.to_le_bytes()], bump)]
    pub margin: Box<Account<'info, MarginAccountV3>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AccountCashV3<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(seeds = [b"ledger-v3", venue.markets[0].as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == venue.markets[0] && btc_ledger.market_index == 0 @ ClearingError::Domain)]
    pub btc_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(seeds = [b"ledger-v3", venue.markets[1].as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == venue.markets[1] && eth_ledger.market_index == 1 @ ClearingError::Domain)]
    pub eth_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, has_one = venue)]
    pub margin: Box<Account<'info, MarginAccountV3>>,
    #[account(address = venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.key() == venue.vault && vault.mint == venue.quote_mint && vault.owner == venue.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_token.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = owner)]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct TransferAccountCustodyV3<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(seeds = [b"ledger-v3", venue.markets[0].as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == venue.markets[0] && btc_ledger.market_index == 0 @ ClearingError::Domain)]
    pub btc_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(seeds = [b"ledger-v3", venue.markets[1].as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == venue.markets[1] && eth_ledger.market_index == 1 @ ClearingError::Domain)]
    pub eth_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(mut, seeds = [b"margin-v3", donor.portfolio.as_ref(), &donor.subaccount_index.to_le_bytes()],
        bump = donor.bump, has_one = owner, has_one = venue)]
    pub donor: Box<Account<'info, MarginAccountV3>>,
    #[account(mut, seeds = [b"margin-v3", recipient.portfolio.as_ref(), &recipient.subaccount_index.to_le_bytes()],
        bump = recipient.bump, has_one = owner, has_one = venue,
        constraint = recipient.key() != donor.key() @ ClearingError::Alias)]
    pub recipient: Box<Account<'info, MarginAccountV3>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.key() == venue.vault && vault.mint == venue.quote_mint && vault.owner == venue.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PauseVenueV3<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(mut, seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(seeds = [b"ledger-v3", venue.markets[0].as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == venue.markets[0] && btc_ledger.market_index == 0 @ ClearingError::Domain)]
    pub btc_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(seeds = [b"ledger-v3", venue.markets[1].as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == venue.markets[1] && eth_ledger.market_index == 1 @ ClearingError::Domain)]
    pub eth_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.key() == venue.vault && vault.mint == venue.quote_mint && vault.owner == venue.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ClassifyMarketSurplusV3<'info> {
    pub reserve_authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"ledger-v3", venue.markets[0].as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == venue.markets[0] && btc_ledger.market_index == 0 @ ClearingError::Domain)]
    pub btc_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(mut, seeds = [b"ledger-v3", venue.markets[1].as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == venue.markets[1] && eth_ledger.market_index == 1 @ ClearingError::Domain)]
    pub eth_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.key() == venue.vault && vault.mint == venue.quote_mint && vault.owner == venue.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SeedMarketInsuranceV3<'info> {
    pub reserve_authority: Signer<'info>,
    pub donor: Signer<'info>,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"ledger-v3", venue.markets[0].as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == venue.markets[0] && btc_ledger.market_index == 0 @ ClearingError::Domain)]
    pub btc_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(mut, seeds = [b"ledger-v3", venue.markets[1].as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == venue.markets[1] && eth_ledger.market_index == 1 @ ClearingError::Domain)]
    pub eth_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(address = venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.key() == venue.vault && vault.mint == venue.quote_mint && vault.owner == venue.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = donor_token.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = donor)]
    pub donor_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

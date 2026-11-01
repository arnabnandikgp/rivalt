//! Schema-3 custody contexts: canonical identities and real SPL token authority.
use crate::{error::ClearingError, state::accounts::*};
use crate::{ProgramData, UpgradeableProgramAddress};
use anchor_lang::prelude::*;
use anchor_spl::{
    mint::Mint,
    token::{self, Token, TokenAccount},
};
#[event_cpi]
#[derive(Accounts)]
#[instruction(domain: [u8; 32])]
pub struct InitializeVenue {
    #[account(mut)]
    pub authority: Signer,
    pub clearing_program: Program<crate::ClearingProgram>,
    #[account(constraint = clearing_program.programdata_address()? == Some(program_data.address().to_owned()) @ ClearingError::Authority,
        constraint = program_data.upgrade_authority_address == Some(authority.address().to_owned()) @ ClearingError::Authority)]
    pub program_data: Box<BorshAccount<ProgramData>>,
    #[account(constraint = quote_mint.decimals() == 6 && quote_mint.freeze_authority().is_none() @ ClearingError::Mint)]
    pub quote_mint: Box<Account<Mint>>,
    #[account(init, payer = authority, space = 8 + Venue::INIT_SPACE, seeds = [b"venue-v3", domain.as_ref()], bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(init, payer = authority, space = 8 + Custody::INIT_SPACE, seeds = [b"custody-v3", venue.address().as_ref()], bump)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(init, payer = authority, space = 8 + VenueSafety::INIT_SPACE, seeds = [b"safety-v3", venue.address().as_ref()], bump)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init, payer = authority, seeds = [b"vault-v3", venue.address().as_ref()], bump,
        token::mint = quote_mint, token::authority = venue)]
    pub vault: Box<Account<TokenAccount>>,
    pub token_program: Program<Token>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeVenueRegistry {
    #[account(mut)]
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init, payer = authority, space = 8 + VenueRegistry::INIT_SPACE,
        seeds = [b"registry-v3", venue.address().as_ref()], bump)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct InitializeMarket {
    #[account(mut)]
    pub authority: Signer,
    #[account(mut, seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init, payer = authority, space = 8 + Market::INIT_SPACE,
        seeds = [b"market-v3", venue.address().as_ref(), &[index]], bump)]
    pub market: Box<BorshAccount<Market>>,
    #[account(init, payer = authority, space = 8 + MarketLedger::INIT_SPACE,
        seeds = [b"ledger-v3", market.address().as_ref()], bump)]
    pub ledger: Box<BorshAccount<MarketLedger>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u16)]
pub struct CreatePortfolio {
    #[account(mut)]
    pub owner: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init, payer = owner, space = 8 + Portfolio::INIT_SPACE,
        seeds = [b"portfolio-v3", venue.address().as_ref(), owner.address().as_ref(), &index.to_le_bytes()], bump)]
    pub portfolio: Box<BorshAccount<Portfolio>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(subaccount_index: u16)]
pub struct RegisterMargin {
    #[account(mut)]
    pub owner: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"registry-v3", venue.address().as_ref()], bump = registry.bump, has_one = venue)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    #[account(mut, seeds = [b"portfolio-v3", venue.address().as_ref(), owner.address().as_ref(), &portfolio.index.to_le_bytes()],
        bump = portfolio.bump, has_one = venue, has_one = owner)]
    pub portfolio: Box<BorshAccount<Portfolio>>,
    #[account(init, payer = owner, space = 8 + MarginAccount::INIT_SPACE,
        seeds = [b"margin-v3", portfolio.address().as_ref(), &subaccount_index.to_le_bytes()], bump)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AccountCash {
    pub owner: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"ledger-v3", venue.markets[0].as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == venue.markets[0] && btc_ledger.market_index == 0 @ ClearingError::Domain)]
    pub btc_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    #[account(mut, seeds = [b"ledger-v3", venue.markets[1].as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == venue.markets[1] && eth_ledger.market_index == 1 @ ClearingError::Domain)]
    pub eth_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, has_one = venue)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    #[account(address = venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<Mint>>,
    #[account(mut, seeds = [b"vault-v3", venue.address().as_ref()], bump = venue.vault_bump,
        constraint = vault.address().to_owned() == venue.vault && *vault.mint() == venue.quote_mint && *vault.owner() == venue.address().to_owned() @ ClearingError::Mint)]
    pub vault: Box<Account<TokenAccount>>,
    #[account(mut, constraint = user_token.address().to_owned() != vault.address().to_owned() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = owner)]
    pub user_token: Box<Account<TokenAccount>>,
    pub token_program: Program<Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct TransferAccountCustody {
    pub owner: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"margin-v3", donor.portfolio.as_ref(), &donor.subaccount_index.to_le_bytes()],
        bump = donor.bump, has_one = owner, has_one = venue)]
    pub donor: Box<BorshAccount<MarginAccount>>,
    #[account(mut, seeds = [b"margin-v3", recipient.portfolio.as_ref(), &recipient.subaccount_index.to_le_bytes()],
        bump = recipient.bump, has_one = owner, has_one = venue,
        constraint = recipient.address().to_owned() != donor.address().to_owned() @ ClearingError::Alias)]
    pub recipient: Box<BorshAccount<MarginAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PauseVenue {
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(mut, seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds = [b"ledger-v3", venue.markets[0].as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == venue.markets[0] && btc_ledger.market_index == 0 @ ClearingError::Domain)]
    pub btc_ledger: Box<BorshAccount<MarketLedger>>,
    #[account(seeds = [b"ledger-v3", venue.markets[1].as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == venue.markets[1] && eth_ledger.market_index == 1 @ ClearingError::Domain)]
    pub eth_ledger: Box<BorshAccount<MarketLedger>>,
    #[account(seeds = [b"vault-v3", venue.address().as_ref()], bump = venue.vault_bump,
        constraint = vault.address().to_owned() == venue.vault && *vault.mint() == venue.quote_mint && *vault.owner() == venue.address().to_owned() @ ClearingError::Mint)]
    pub vault: Box<Account<TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ClassifyMarketSurplus {
    pub reserve_authority: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && ledger.market == venue.markets[ledger.market_index as usize] @ ClearingError::Profile)]
    pub ledger: Box<BorshAccount<MarketLedger>>,
    #[account(seeds = [b"vault-v3", venue.address().as_ref()], bump = venue.vault_bump,
        constraint = vault.address().to_owned() == venue.vault && *vault.mint() == venue.quote_mint && *vault.owner() == venue.address().to_owned() @ ClearingError::Mint)]
    pub vault: Box<Account<TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SeedMarketInsurance {
    pub reserve_authority: Signer,
    pub donor: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && ledger.market == venue.markets[ledger.market_index as usize] @ ClearingError::Profile)]
    pub ledger: Box<BorshAccount<MarketLedger>>,
    #[account(address = venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<Mint>>,
    #[account(mut, seeds = [b"vault-v3", venue.address().as_ref()], bump = venue.vault_bump,
        constraint = vault.address().to_owned() == venue.vault && *vault.mint() == venue.quote_mint && *vault.owner() == venue.address().to_owned() @ ClearingError::Mint)]
    pub vault: Box<Account<TokenAccount>>,
    #[account(mut, constraint = donor_token.address().to_owned() != vault.address().to_owned() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = donor)]
    pub donor_token: Box<Account<TokenAccount>>,
    pub token_program: Program<Token>,
}

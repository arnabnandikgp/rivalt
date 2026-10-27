//! Canonical account/custody boundaries. No maker receives these accounts by CPI.
use super::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct AccountFinancialIdentityV3<'info> {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = vault)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
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
    #[account(mut, seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.owner == venue.key() && vault.mint == venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawFundedAccountV3<'info> {
    pub identity: AccountFinancialIdentityV3<'info>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, constraint = margin.venue == identity.venue.key() @ ClearingError::Profile)]
    pub margin: Box<Account<'info, MarginAccountV3>>,
    #[account(address = identity.venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = user_token.key() != identity.vault.key() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = owner)]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct TransferFundedAccountV3<'info> {
    pub identity: AccountFinancialIdentityV3<'info>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", donor.portfolio.as_ref(), &donor.subaccount_index.to_le_bytes()],
        bump = donor.bump, has_one = owner, constraint = donor.venue == identity.venue.key() @ ClearingError::Profile)]
    pub donor: Box<Account<'info, MarginAccountV3>>,
    #[account(mut, seeds = [b"margin-v3", recipient.portfolio.as_ref(), &recipient.subaccount_index.to_le_bytes()],
        bump = recipient.bump, has_one = owner, constraint = recipient.venue == identity.venue.key() @ ClearingError::Profile,
        constraint = recipient.key() != donor.key() @ ClearingError::Alias)]
    pub recipient: Box<Account<'info, MarginAccountV3>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ChangeAccountClaimV3<'info> {
    pub identity: AccountFinancialIdentityV3<'info>,
    /// Any payer can perform an admissible collection/payment; no cash destination choice.
    pub actor: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, constraint = margin.venue == identity.venue.key() @ ClearingError::Profile)]
    pub margin: Box<Account<'info, MarginAccountV3>>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    /// Absent for collection; validated completely before gain payment.
    pub certificate: Option<Box<Account<'info, SettlementCertificateV3>>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct NetAccountClaimsV3<'info> {
    pub identity: AccountFinancialIdentityV3<'info>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, constraint = margin.venue == identity.venue.key() @ ClearingError::Profile)]
    pub margin: Box<Account<'info, MarginAccountV3>>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    pub certificate: Box<Account<'info, SettlementCertificateV3>>,
}

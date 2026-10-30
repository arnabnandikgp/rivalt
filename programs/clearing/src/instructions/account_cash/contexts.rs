//! Canonical account/custody boundaries. No maker receives these accounts by CPI.
use super::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct AccountFinancialIdentity<'info> {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Option<Box<Account<'info, Market>>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Option<Box<Account<'info, Market>>>,
}

impl AccountFinancialIdentity<'_> {
    pub(crate) fn markets(&self) -> [Option<&Market>; 2] {
        [
            self.btc.as_deref().map(|market| &**market),
            self.eth.as_deref().map(|market| &**market),
        ]
    }
    pub(crate) fn materialize(&mut self, clock: &Clock) -> Result<()> {
        trading::materialize_optional(
            [
                self.btc.as_deref_mut().map(|market| &mut **market),
                self.eth.as_deref_mut().map(|market| &mut **market),
            ],
            clock,
        )
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawFundedAccount<'info> {
    pub identity: AccountFinancialIdentity<'info>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.key() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Option<Box<Account<'info, MarketLedger>>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.key() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Option<Box<Account<'info, MarketLedger>>>,
    #[account(mut, seeds = [b"custody-v3", identity.venue.key().as_ref()], bump = custody.bump,
        constraint = custody.venue == identity.venue.key() @ ClearingError::Profile)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(mut, seeds = [b"vault-v3", identity.venue.key().as_ref()], bump = identity.venue.vault_bump,
        constraint = vault.key() == identity.venue.vault && vault.owner == identity.venue.key()
            && vault.mint == identity.venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, constraint = margin.venue == identity.venue.key() @ ClearingError::Profile)]
    pub margin: Box<Account<'info, MarginAccount>>,
    #[account(address = identity.venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = user_token.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = owner)]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct TransferFundedAccount<'info> {
    pub identity: AccountFinancialIdentity<'info>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.key() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Option<Box<Account<'info, MarketLedger>>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.key() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Option<Box<Account<'info, MarketLedger>>>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", donor.portfolio.as_ref(), &donor.subaccount_index.to_le_bytes()],
        bump = donor.bump, has_one = owner, constraint = donor.venue == identity.venue.key() @ ClearingError::Profile)]
    pub donor: Box<Account<'info, MarginAccount>>,
    #[account(mut, seeds = [b"margin-v3", recipient.portfolio.as_ref(), &recipient.subaccount_index.to_le_bytes()],
        bump = recipient.bump, has_one = owner, constraint = recipient.venue == identity.venue.key() @ ClearingError::Profile,
        constraint = recipient.key() != donor.key() @ ClearingError::Alias)]
    pub recipient: Box<Account<'info, MarginAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ChangeAccountClaim<'info> {
    pub identity: AccountFinancialIdentity<'info>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.key() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Option<Box<Account<'info, MarketLedger>>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.key() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Option<Box<Account<'info, MarketLedger>>>,
    /// Any payer can perform an admissible collection/payment; no cash destination choice.
    pub actor: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, constraint = margin.venue == identity.venue.key() @ ClearingError::Profile)]
    pub margin: Box<Account<'info, MarginAccount>>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    /// Absent for collection; validated completely before gain payment.
    pub certificate: Option<Box<Account<'info, SettlementCertificate>>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct NetAccountClaims<'info> {
    pub identity: AccountFinancialIdentity<'info>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.key() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Box<Account<'info, MarketLedger>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.key() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Box<Account<'info, MarketLedger>>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, constraint = margin.venue == identity.venue.key() @ ClearingError::Profile)]
    pub margin: Box<Account<'info, MarginAccount>>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    pub certificate: Box<Account<'info, SettlementCertificate>>,
}

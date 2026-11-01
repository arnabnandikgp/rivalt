//! Canonical account/custody boundaries. No maker receives these accounts by CPI.
use super::*;
use anchor_spl::{
    mint::Mint,
    token::{self, Token, TokenAccount},
};

#[derive(Accounts)]
pub struct AccountFinancialIdentity {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.address().to_owned() @ ClearingError::Profile)]
    pub btc: Option<Box<BorshAccount<Market>>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.address().to_owned() @ ClearingError::Profile)]
    pub eth: Option<Box<BorshAccount<Market>>>,
}

impl AccountFinancialIdentity {
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
pub struct WithdrawFundedAccount {
    pub identity: Nested<AccountFinancialIdentity>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.address().to_owned() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.address().to_owned() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    #[account(mut, seeds = [b"custody-v3", identity.venue.address().as_ref()], bump = custody.bump,
        constraint = custody.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(mut, seeds = [b"vault-v3", identity.venue.address().as_ref()], bump = identity.venue.vault_bump,
        constraint = vault.address().to_owned() == identity.venue.vault && *vault.owner() == identity.venue.address().to_owned()
            && *vault.mint() == identity.venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<TokenAccount>>,
    pub owner: Signer,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, constraint = margin.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    #[account(address = identity.venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<Mint>>,
    #[account(mut, constraint = user_token.address().to_owned() != vault.address().to_owned() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = owner)]
    pub user_token: Box<Account<TokenAccount>>,
    pub token_program: Program<Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct TransferFundedAccount {
    pub identity: Nested<AccountFinancialIdentity>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.address().to_owned() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.address().to_owned() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    pub owner: Signer,
    #[account(mut, seeds = [b"margin-v3", donor.portfolio.as_ref(), &donor.subaccount_index.to_le_bytes()],
        bump = donor.bump, has_one = owner, constraint = donor.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub donor: Box<BorshAccount<MarginAccount>>,
    #[account(mut, seeds = [b"margin-v3", recipient.portfolio.as_ref(), &recipient.subaccount_index.to_le_bytes()],
        bump = recipient.bump, has_one = owner, constraint = recipient.venue == identity.venue.address().to_owned() @ ClearingError::Profile,
        constraint = recipient.address().to_owned() != donor.address().to_owned() @ ClearingError::Alias)]
    pub recipient: Box<BorshAccount<MarginAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ChangeAccountClaim {
    pub identity: Nested<AccountFinancialIdentity>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.address().to_owned() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.address().to_owned() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    /// Any payer can perform an admissible collection/payment; no cash destination choice.
    pub actor: Signer,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, constraint = margin.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    #[account(seeds = [b"registry-v3", identity.venue.address().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    /// Absent for collection; validated completely before gain payment.
    pub certificate: Option<Box<BorshAccount<SettlementCertificate>>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct NetAccountClaims {
    pub identity: Nested<AccountFinancialIdentity>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.address().to_owned() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Box<BorshAccount<MarketLedger>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.address().to_owned() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Box<BorshAccount<MarketLedger>>,
    pub owner: Signer,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, constraint = margin.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    #[account(seeds = [b"registry-v3", identity.venue.address().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.address().to_owned() @ ClearingError::Profile)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    pub certificate: Box<BorshAccount<SettlementCertificate>>,
}

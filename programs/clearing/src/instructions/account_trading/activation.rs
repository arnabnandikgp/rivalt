//! Qualification-only transition. The ordinary schema-3 profile stays gated until P26.
use super::*;
use anchor_spl::token::TokenAccount;

#[event_cpi]
#[derive(Accounts)]
pub struct QualifyAccountTradingV3<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority, has_one = vault)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(mut, seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"ledger-v3", btc.key().as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == btc.key() @ ClearingError::Profile)]
    pub btc_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(seeds = [b"ledger-v3", eth.key().as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == eth.key() @ ClearingError::Profile)]
    pub eth_ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.owner == venue.key() && vault.mint == venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

pub fn qualify(ctx: Context<QualifyAccountTradingV3>) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    profile(&accounts.venue, &accounts.custody, &accounts.safety)?;
    require!(accounts.safety.mode == CUSTODY, ClearingError::Profile);
    super::super::account_custody::reconciled(
        &accounts.custody,
        [&accounts.btc_ledger, &accounts.eth_ledger],
        accounts.vault.amount,
    )?;
    let clock = Clock::get()?;
    for (market, ledger) in [
        (&mut accounts.btc, &accounts.btc_ledger),
        (&mut accounts.eth, &accounts.eth_ledger),
    ] {
        require!(
            market.gross_lots == 0
                && market.funding_index_scaled == 0
                && ledger.settlement == 0
                && ledger.fees == 0
                && ledger.insurance_fee_remainder == 0,
            ClearingError::Profile
        );
        oracle::action(market, &clock, true)?;
        let mut view = market_view(market)?;
        super::super::group_safety::settlement::reset_oracle(&mut view, clock.unix_timestamp, 0)?;
        commit_market(market, &view)?;
    }
    accounts.safety.mode = ACTIVE;
    increment(&mut accounts.safety.epoch)?;
    increment(&mut accounts.custody.sequence)?;
    let emitted = crate::events::AccountQualificationV3 {
        venue: accounts.venue.key(),
        sequence: accounts.custody.sequence,
        slot: clock.slot,
        safety_epoch: accounts.safety.epoch,
        markets: [
            crate::events::MarketSnapshotV3::from(&**accounts.btc),
            crate::events::MarketSnapshotV3::from(&**accounts.eth),
        ],
    };
    crate::event_cpi::emit(&emitted, accounts.event_authority.to_account_info())
}

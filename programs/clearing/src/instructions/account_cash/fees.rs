//! Market-local treasury accounting; only actual token exits load custody.
use super::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct TreasuryIdentity<'info> {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && ledger.market == venue.markets[ledger.market_index as usize] @ ClearingError::Profile)]
    pub ledger: Box<Account<'info, MarketLedger>>,
}

#[derive(Accounts)]
pub struct TreasuryTokenIdentity<'info> {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = vault)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && ledger.market == venue.markets[ledger.market_index as usize] @ ClearingError::Profile)]
    pub ledger: Box<Account<'info, MarketLedger>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(mut, seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.owner == venue.key() && vault.mint == venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AllocateMarketFees<'info> {
    pub identity: TreasuryIdentity<'info>,
    #[account(address = identity.venue.fee_authority @ ClearingError::Authority)]
    pub fee_authority: Signer<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawMarketFees<'info> {
    pub identity: TreasuryTokenIdentity<'info>,
    #[account(address = identity.venue.fee_authority @ ClearingError::Authority)]
    pub fee_authority: Signer<'info>,
    #[account(address = identity.venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = quote_mint, token::authority = fee_authority,
        constraint = user_token.key() != identity.vault.key() @ ClearingError::Alias)]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub(crate) fn treasury_profile(
    venue: &Venue,
    safety: &VenueSafety,
    ledger: &MarketLedger,
    selected: u8,
) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && venue.schema_version == SCHEMA_VERSION
            && trading::supported_profile(venue)
            && venue.insurance_fee_share_bps == 2500
            && safety.schema_version == SCHEMA_VERSION
            && matches!(safety.mode, CUSTODY | ACTIVE | RESOLVED | RETIRED)
            && selected < 2
            && ledger.market_index == selected
            && ledger.schema_version == SCHEMA_VERSION
            && ledger.insurance_fee_remainder < 4,
        ClearingError::Profile
    );
    require!(!safety.paused, ClearingError::Paused);
    Ok(())
}

pub fn allocate(
    ctx: &mut Context<AllocateMarketFees>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
    amount: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && amount > 0,
        ClearingError::Amount
    );
    let accounts = &mut *ctx.accounts;
    let identity = &mut accounts.identity;
    treasury_profile(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        market_index,
    )?;
    identity.ledger.fees = checked(math::cash_sub(identity.ledger.fees, amount))?;
    identity.ledger.insurance = checked(math::cash_add(identity.ledger.insurance, amount))?;
    increment(&mut identity.ledger.version)?;
    emit_treasury(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        events,
        accounts.event_authority.to_account_info(),
        accounts.fee_authority.key(),
        5,
        amount,
        None,
    )
}

pub fn withdraw(
    ctx: &mut Context<WithdrawMarketFees>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
    amount: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && amount > 0,
        ClearingError::Amount
    );
    let accounts = &mut *ctx.accounts;
    let identity = &mut accounts.identity;
    treasury_profile(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        market_index,
    )?;
    super::super::account_custody::vault_backed(&identity.custody, identity.vault.amount)?;
    identity.ledger.fees = checked(math::cash_sub(identity.ledger.fees, amount))?;
    identity.custody.allocated_vault =
        checked(math::cash_sub(identity.custody.allocated_vault, amount))?;
    increment(&mut identity.ledger.version)?;
    let bump = [identity.venue.bump];
    let seeds: &[&[u8]] = &[b"venue-v3", &identity.venue.domain, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            accounts.token_program.key(),
            TransferChecked {
                from: identity.vault.to_account_info(),
                to: accounts.user_token.to_account_info(),
                mint: accounts.quote_mint.to_account_info(),
                authority: identity.venue.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        6,
    )?;
    identity.vault.reload()?;
    super::super::account_custody::vault_backed(&identity.custody, identity.vault.amount)?;
    emit_treasury(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        events,
        accounts.event_authority.to_account_info(),
        accounts.fee_authority.key(),
        6,
        amount,
        Some((identity.custody.allocated_vault, identity.vault.amount)),
    )
}

fn emit_treasury<'info>(
    venue: &Account<Venue>,
    safety: &VenueSafety,
    ledger: &Account<MarketLedger>,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountInfo<'info>,
    actor: Pubkey,
    kind: u8,
    amount: u64,
    tokens: Option<(u64, u64)>,
) -> Result<()> {
    events.emit(
        &crate::events::AccountFinancialChanged {
            venue: venue.key(),
            slot: Clock::get()?.slot,
            actor,
            kind,
            market_index: ledger.market_index,
            amount,
            safety_epoch: safety.epoch,
            allocated_vault: tokens.map(|value| value.0),
            actual_vault: tokens.map(|value| value.1),
            roots: vec![],
            root_states: vec![],
            markets: vec![],
            ledgers: vec![super::super::account_custody::ledger_snapshot(ledger)],
        },
        authority,
    )
}

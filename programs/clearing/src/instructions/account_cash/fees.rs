//! Collected T belongs to the configured fee authority; I is never an active exit.
use super::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[event_cpi]
#[derive(Accounts)]
pub struct ManageMarketFeesV3<'info> {
    pub identity: AccountFinancialIdentityV3<'info>,
    #[account(address = identity.venue.fee_authority @ ClearingError::Authority)]
    pub fee_authority: Signer<'info>,
    #[account(address = identity.venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = quote_mint, token::authority = fee_authority,
        constraint = user_token.key() != identity.vault.key() @ ClearingError::Alias)]
    pub user_token: Option<Box<Account<'info, TokenAccount>>>,
    pub token_program: Program<'info, Token>,
}

pub fn manage(
    ctx: Context<ManageMarketFeesV3>,
    market_index: u8,
    amount: u64,
    withdraw: bool,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && market_index < 2 && amount > 0,
        ClearingError::Amount
    );
    let accounts = &mut *ctx.accounts;
    let identity = &mut accounts.identity;
    require!(
        cfg!(feature = "account-cash-qualification")
            && identity.venue.schema_version == SCHEMA_VERSION
            && trading::financial_profile_version(&identity.venue)
            && identity.venue.insurance_fee_share_bps == 2500
            && identity.custody.schema_version == SCHEMA_VERSION
            && identity.safety.schema_version == SCHEMA_VERSION
            && matches!(identity.safety.mode, CUSTODY | ACTIVE | RESOLVED | RETIRED),
        ClearingError::Profile
    );
    require!(!identity.safety.paused, ClearingError::Paused);
    super::super::account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )?;
    let ledger = if market_index == 0 {
        &mut identity.btc_ledger
    } else {
        &mut identity.eth_ledger
    };
    ledger.fees = checked(math::cash_sub(ledger.fees, amount))?;
    increment(&mut ledger.version)?;
    if withdraw {
        let destination = accounts.user_token.as_ref().ok_or(ClearingError::Mint)?;
        identity.custody.allocated_vault =
            checked(math::cash_sub(identity.custody.allocated_vault, amount))?;
        let bump = [identity.venue.bump];
        let seeds: &[&[u8]] = &[b"venue-v3", &identity.venue.domain, &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                accounts.token_program.key(),
                TransferChecked {
                    from: identity.vault.to_account_info(),
                    to: destination.to_account_info(),
                    mint: accounts.quote_mint.to_account_info(),
                    authority: identity.venue.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            6,
        )?;
        identity.vault.reload()?;
    } else {
        require!(accounts.user_token.is_none(), ClearingError::Profile);
        ledger.insurance = checked(math::cash_add(ledger.insurance, amount))?;
    }
    // T/I are excluded from profit backing; do not consume funding or invalidate
    // a payment certificate merely for treasury bookkeeping.
    increment(&mut identity.custody.sequence)?;
    super::super::account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )?;
    emit(
        identity,
        accounts.event_authority.to_account_info(),
        accounts.fee_authority.key(),
        if withdraw { 6 } else { 5 },
        market_index,
        amount,
        &[],
        Clock::get()?.slot,
    )
}

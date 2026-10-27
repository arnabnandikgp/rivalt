use super::*;
use anchor_spl::token::{self, TransferChecked};
use trading::authority::AccountGuardV3;

pub fn withdraw(
    ctx: Context<WithdrawFundedAccountV3>,
    guard: AccountGuardV3,
    amount: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    let snapshot = begin(&accounts.identity)?;
    guard.check(
        &accounts.identity.venue,
        &accounts.identity.safety,
        &accounts.margin,
    )?;
    let candidate = withdraw_candidate(&accounts.margin, &snapshot, amount)?;
    commit(&mut accounts.identity, &mut accounts.margin, &candidate)?;
    accounts.identity.custody.total_cash =
        checked(math::cash_sub(accounts.identity.custody.total_cash, amount))?;
    accounts.identity.custody.allocated_vault = checked(math::cash_sub(
        accounts.identity.custody.allocated_vault,
        amount,
    ))?;
    let bump = [accounts.identity.venue.bump];
    let seeds: &[&[u8]] = &[b"venue-v3", &accounts.identity.venue.domain, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            accounts.token_program.key(),
            TransferChecked {
                from: accounts.identity.vault.to_account_info(),
                mint: accounts.quote_mint.to_account_info(),
                to: accounts.user_token.to_account_info(),
                authority: accounts.identity.venue.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        6,
    )?;
    accounts.identity.vault.reload()?;
    finish(&mut accounts.identity, &snapshot.clock)?;
    emit(
        &accounts.identity,
        accounts.event_authority.to_account_info(),
        accounts.owner.key(),
        0,
        255,
        amount,
        &[&accounts.margin],
        snapshot.clock.slot,
    )
}

pub fn transfer(
    ctx: Context<TransferFundedAccountV3>,
    guard: AccountGuardV3,
    amount: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    let snapshot = begin(&accounts.identity)?;
    guard.check(
        &accounts.identity.venue,
        &accounts.identity.safety,
        &accounts.donor,
    )?;
    let donor = withdraw_candidate(&accounts.donor, &snapshot, amount)?;
    let recipient = receive_candidate(&accounts.recipient, &snapshot, amount)?;
    commit(&mut accounts.identity, &mut accounts.donor, &donor)?;
    commit(&mut accounts.identity, &mut accounts.recipient, &recipient)?;
    finish(&mut accounts.identity, &snapshot.clock)?;
    emit(
        &accounts.identity,
        accounts.event_authority.to_account_info(),
        accounts.owner.key(),
        1,
        255,
        amount,
        &[&accounts.donor, &accounts.recipient],
        snapshot.clock.slot,
    )
}

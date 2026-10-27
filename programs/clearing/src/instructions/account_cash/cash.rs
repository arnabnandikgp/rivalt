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
    guard.check(
        &accounts.identity.venue,
        &accounts.identity.safety,
        &accounts.margin,
    )?;
    let terminal = matches!(accounts.identity.safety.mode, RESOLVED | RETIRED);
    let clock = if terminal {
        terminal_exit(&accounts.identity, &mut accounts.margin, amount)?;
        Clock::get()?
    } else {
        let snapshot = begin(&accounts.identity)?;
        let candidate = withdraw_candidate(&accounts.margin, &snapshot, amount)?;
        commit(&mut accounts.identity, &mut accounts.margin, &candidate)?;
        snapshot.clock
    };
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
    if terminal {
        // A resolved/retired exit consumes no new funding interval and has no
        // artificial source dependency. Resolution has zeroed every claim.
        increment(&mut accounts.identity.custody.sequence)?;
        super::super::account_custody::reconciled(
            &accounts.identity.custody,
            [&accounts.identity.btc_ledger, &accounts.identity.eth_ledger],
            accounts.identity.vault.amount,
        )?;
    } else {
        finish(&mut accounts.identity, &clock)?;
    }
    emit(
        &accounts.identity,
        accounts.event_authority.to_account_info(),
        accounts.owner.key(),
        0,
        255,
        amount,
        &[&accounts.margin],
        clock.slot,
    )
}

fn terminal_exit(
    identity: &AccountFinancialIdentityV3,
    root: &mut MarginAccountV3,
    amount: u64,
) -> Result<()> {
    require!(
        cfg!(feature = "account-safety-qualification")
            && identity.venue.schema_version == SCHEMA_VERSION
            && identity.venue.profile_version == PROFILE_VERSION
            && identity.venue.market_count == 2
            && identity.venue.insurance_fee_share_bps == 2500
            && identity.custody.schema_version == SCHEMA_VERSION
            && identity.safety.schema_version == SCHEMA_VERSION
            && matches!(identity.safety.mode, RESOLVED | RETIRED)
            && !identity.safety.paused,
        ClearingError::Profile
    );
    trading::model(root)?;
    require!(
        amount > 0
            && root.reserved == 0
            && root
                .positions
                .iter()
                .all(|position| position.lots == 0 && position.virtual_scaled == 0)
            && root
                .book
                .orders
                .iter()
                .all(|entry| !entry.order.active() && entry.order.reserve == 0),
        ClearingError::Resolution
    );
    super::super::account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )?;
    root.cash = checked(math::cash_sub(root.cash, amount))?;
    increment(&mut root.nonce)?;
    increment(&mut root.state_version)
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

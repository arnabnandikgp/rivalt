use super::*;
use anchor_spl::token::{self, TransferChecked};
use trading::authority::AccountGuard;

pub fn withdraw(
    ctx: &mut Context<WithdrawFundedAccount>,
    events: &mut crate::event_cpi::Payloads,
    guard: AccountGuard,
    amount: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    guard.check(
        &accounts.identity.venue,
        &accounts.identity.safety,
        &accounts.margin,
    )?;
    super::super::account_custody::vault_backed(&accounts.custody, accounts.vault.amount)?;
    let terminal = matches!(accounts.identity.safety.mode, RESOLVED | RETIRED)
        || super::super::account_custody::recovered_custody(&accounts.identity.safety);
    let clock = if terminal {
        terminal_exit(&accounts.identity, &mut accounts.margin, amount)?;
        Clock::get()?
    } else {
        let snapshot = begin(&accounts.identity)?;
        let candidate = withdraw_candidate(&accounts.margin, &snapshot, amount)?;
        commit(
            &mut accounts.margin,
            &candidate,
            [
                accounts
                    .btc_ledger
                    .as_deref_mut()
                    .map(|ledger| &mut **ledger),
                accounts
                    .eth_ledger
                    .as_deref_mut()
                    .map(|ledger| &mut **ledger),
            ],
        )?;
        snapshot.clock
    };
    accounts.custody.allocated_vault =
        checked(math::cash_sub(accounts.custody.allocated_vault, amount))?;
    let bump = [accounts.identity.venue.bump];
    let seeds: &[&[u8]] = &[b"venue-v3", &accounts.identity.venue.domain, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            accounts.token_program.key(),
            TransferChecked {
                from: accounts.vault.to_account_info(),
                mint: accounts.quote_mint.to_account_info(),
                to: accounts.user_token.to_account_info(),
                authority: accounts.identity.venue.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        6,
    )?;
    accounts.vault.reload()?;
    if !terminal {
        finish(&mut accounts.identity, &clock)?;
    }
    super::super::account_custody::vault_backed(&accounts.custody, accounts.vault.amount)?;

    emit(
        &accounts.identity,
        events,
        accounts.event_authority.to_account_info(),
        accounts.owner.key(),
        0,
        255,
        amount,
        &[&accounts.margin],
        &[
            accounts.btc_ledger.as_deref(),
            accounts.eth_ledger.as_deref(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>(),
        Some((accounts.custody.allocated_vault, accounts.vault.amount)),
        clock.slot,
    )
}

fn terminal_exit(
    identity: &AccountFinancialIdentity,
    root: &mut MarginAccount,
    amount: u64,
) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && identity.venue.schema_version == SCHEMA_VERSION
            && trading::supported_profile(&identity.venue)
            && identity.venue.market_count == 2
            && identity.venue.insurance_fee_share_bps == 2500
            && identity.safety.schema_version == SCHEMA_VERSION
            && (matches!(identity.safety.mode, RESOLVED | RETIRED)
                || super::super::account_custody::recovered_custody(&identity.safety))
            && !identity.safety.paused,
        ClearingError::Profile
    );
    require!(amount > 0, ClearingError::Amount);
    super::super::account_custody::liability_free(root)?;
    root.cash = checked(math::cash_sub(root.cash, amount))?;
    increment(&mut root.nonce)?;
    increment(&mut root.state_version)
}

pub fn transfer(
    ctx: &mut Context<TransferFundedAccount>,
    events: &mut crate::event_cpi::Payloads,
    guard: AccountGuard,
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
    commit(
        &mut accounts.donor,
        &donor,
        [
            accounts
                .btc_ledger
                .as_deref_mut()
                .map(|ledger| &mut **ledger),
            accounts
                .eth_ledger
                .as_deref_mut()
                .map(|ledger| &mut **ledger),
        ],
    )?;
    commit(
        &mut accounts.recipient,
        &recipient,
        [
            accounts
                .btc_ledger
                .as_deref_mut()
                .map(|ledger| &mut **ledger),
            accounts
                .eth_ledger
                .as_deref_mut()
                .map(|ledger| &mut **ledger),
        ],
    )?;
    finish(&mut accounts.identity, &snapshot.clock)?;
    emit(
        &accounts.identity,
        events,
        accounts.event_authority.to_account_info(),
        accounts.owner.key(),
        1,
        255,
        amount,
        &[&accounts.donor, &accounts.recipient],
        &[
            accounts.btc_ledger.as_deref(),
            accounts.eth_ledger.as_deref(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>(),
        None,
        snapshot.clock.slot,
    )
}

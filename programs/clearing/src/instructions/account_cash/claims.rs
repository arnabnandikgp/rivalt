use super::*;
use trading::authority::AccountGuardV3;

pub fn change(
    ctx: Context<ChangeAccountClaimV3>,
    market_index: u8,
    amount: u64,
    gain: bool,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && market_index < 2,
        ClearingError::Profile
    );
    let accounts = &mut *ctx.accounts;
    let snapshot = begin(&accounts.identity)?;
    let selected = usize::from(market_index);
    if gain {
        let certificate = accounts
            .certificate
            .as_ref()
            .ok_or(ClearingError::ExitCohort)?;
        certificate::certified(
            certificate,
            &accounts.identity,
            &accounts.registry,
            &snapshot,
            selected,
        )?;
    } else {
        require!(accounts.certificate.is_none(), ClearingError::Profile);
    }
    let pool = if selected == 0 {
        accounts.identity.btc_ledger.settlement
    } else {
        accounts.identity.eth_ledger.settlement
    };
    let (candidate, pool) =
        claim_candidate(&accounts.margin, &snapshot, selected, amount, gain, pool)?;
    commit(&mut accounts.identity, &mut accounts.margin, &candidate)?;
    let ledger = if selected == 0 {
        &mut accounts.identity.btc_ledger
    } else {
        &mut accounts.identity.eth_ledger
    };
    ledger.settlement = pool;
    increment(&mut ledger.version)?;
    increment(&mut accounts.identity.custody.liability_versions[selected])?;
    accounts.identity.custody.total_cash = checked(if gain {
        math::cash_add(accounts.identity.custody.total_cash, amount)
    } else {
        math::cash_sub(accounts.identity.custody.total_cash, amount)
    })?;
    finish(&mut accounts.identity, &snapshot.clock)?;
    emit(
        &accounts.identity,
        accounts.event_authority.to_account_info(),
        accounts.actor.key(),
        if gain { 3 } else { 2 },
        market_index,
        amount,
        &[&accounts.margin],
        snapshot.clock.slot,
    )
}

pub fn net(
    ctx: Context<NetAccountClaimsV3>,
    guard: AccountGuardV3,
    source_market: u8,
    amount: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && source_market < 2,
        ClearingError::Profile
    );
    let accounts = &mut *ctx.accounts;
    let snapshot = begin(&accounts.identity)?;
    guard.check(
        &accounts.identity.venue,
        &accounts.identity.safety,
        &accounts.margin,
    )?;
    certificate::certified(
        &accounts.certificate,
        &accounts.identity,
        &accounts.registry,
        &snapshot,
        usize::from(source_market),
    )?;
    let (candidate, pools) = net_candidate(
        &accounts.margin,
        &snapshot,
        usize::from(source_market),
        amount,
        [
            accounts.identity.btc_ledger.settlement,
            accounts.identity.eth_ledger.settlement,
        ],
    )?;
    commit(&mut accounts.identity, &mut accounts.margin, &candidate)?;
    accounts.identity.btc_ledger.settlement = pools[0];
    accounts.identity.eth_ledger.settlement = pools[1];
    increment(&mut accounts.identity.btc_ledger.version)?;
    increment(&mut accounts.identity.eth_ledger.version)?;
    for version in &mut accounts.identity.custody.liability_versions {
        increment(version)?;
    }
    finish(&mut accounts.identity, &snapshot.clock)?;
    emit(
        &accounts.identity,
        accounts.event_authority.to_account_info(),
        accounts.owner.key(),
        4,
        source_market,
        amount,
        &[&accounts.margin],
        snapshot.clock.slot,
    )
}

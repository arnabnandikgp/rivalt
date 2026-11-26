use super::*;
use trading::authority::AccountGuard;

pub fn change(
    ctx: &mut Context<ChangeAccountClaim>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
    amount: u64,
    gain: bool,
) -> Result<()> {
    let remaining_accounts = crate::scoped_history::economic_accounts(ctx)?;
    require!(
        remaining_accounts.is_empty() && market_index < 2,
        ClearingError::Profile
    );
    #[cfg(feature = "direct-closed-credit")]
    let direct_lanes = if gain && ctx.accounts.certificate.is_none() {
        Some(ctx.remaining_accounts()?)
    } else {
        None
    };
    let accounts = &mut ctx.accounts;
    let snapshot = begin(&accounts.identity)?;
    let selected = usize::from(market_index);
    let selected_ledger = if selected == 0 {
        accounts.btc_ledger.as_deref()
    } else {
        accounts.eth_ledger.as_deref()
    }
    .ok_or(ClearingError::OrderState)?;
    if gain {
        if let Some(certificate) = accounts.certificate.as_ref() {
            certificate::certified(certificate, &accounts.identity, &accounts.registry, &snapshot, selected_ledger, selected)?;
        } else {
            #[cfg(not(feature = "direct-closed-credit"))]
            return Err(ClearingError::ExitCohort.into());
            #[cfg(feature = "direct-closed-credit")]
            {
                require!(
                    accounts.margin.lifecycle == MEMBER_FINANCIAL && selected_ledger.schema_version == SCHEMA_VERSION
                        && accounts.identity.btc.is_some() && accounts.identity.eth.is_some(),
                    ClearingError::ExitCohort
                );
                crate::instructions::account_membership::members::registry(&accounts.registry)?;
                require!(crate::shadow_coverage::market_backed(
                    accounts.identity.venue.address(), &accounts.registry, &snapshot, selected,
                    direct_lanes.as_deref().ok_or(ClearingError::ExitCohort)?, selected_ledger.settlement
                )?, ClearingError::ExitCohort);
            }
        }
    } else {
        require!(accounts.certificate.is_none(), ClearingError::Profile);
    }
    let pool = selected_ledger.settlement;
    let (candidate, pool) =
        claim_candidate(&accounts.margin, &snapshot, selected, amount, gain, pool)?;
    #[cfg(feature = "profit-attribution-qualification")]
    if gain {
        let claim = snapshot.claims(crate::engine::account::model(&accounts.margin)?)?[selected];
        crate::profit_attribution::payment(&mut accounts.margin, selected, snapshot.market(selected)?.reference_price, claim, amount)?;
    }
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
        &accounts.identity.safety,
    )?;
    let ledger = if selected == 0 {
        accounts
            .btc_ledger
            .as_deref_mut()
            .ok_or(ClearingError::OrderState)?
    } else {
        accounts
            .eth_ledger
            .as_deref_mut()
            .ok_or(ClearingError::OrderState)?
    };
    ledger.settlement = pool;
    increment(&mut ledger.version)?;
    increment(&mut ledger.liability_version)?;
    finish(&mut accounts.identity, &snapshot.clock)?;
    emit(
        &accounts.identity,
        events,
        accounts.event_authority.account().clone(),
        accounts.actor.address().to_owned(),
        if gain { 3 } else { 2 },
        market_index,
        amount,
        &[&accounts.margin],
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

pub fn net(
    ctx: &mut Context<NetAccountClaims>,
    events: &mut crate::event_cpi::Payloads,
    guard: AccountGuard,
    source_market: u8,
    amount: u64,
) -> Result<()> {
    let mut remaining_accounts = crate::scoped_history::economic_accounts(ctx)?;
    require!(
        remaining_accounts.is_empty() && source_market < 2,
        ClearingError::Profile
    );
    let accounts = &mut ctx.accounts;
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
        if source_market == 0 {
            &accounts.btc_ledger
        } else {
            &accounts.eth_ledger
        },
        usize::from(source_market),
    )?;
    let (candidate, pools) = net_candidate(
        &accounts.margin,
        &snapshot,
        usize::from(source_market),
        amount,
        [
            accounts.btc_ledger.settlement,
            accounts.eth_ledger.settlement,
        ],
    )?;
    commit(
        &mut accounts.margin,
        &candidate,
        [
            Some(&mut accounts.btc_ledger),
            Some(&mut accounts.eth_ledger),
        ],
        &accounts.identity.safety,
    )?;
    accounts.btc_ledger.settlement = pools[0];
    accounts.eth_ledger.settlement = pools[1];
    increment(&mut accounts.btc_ledger.version)?;
    increment(&mut accounts.eth_ledger.version)?;
    increment(&mut accounts.btc_ledger.liability_version)?;
    increment(&mut accounts.eth_ledger.liability_version)?;
    finish(&mut accounts.identity, &snapshot.clock)?;
    emit(
        &accounts.identity,
        events,
        accounts.event_authority.account().clone(),
        accounts.owner.address().to_owned(),
        4,
        source_market,
        amount,
        &[&accounts.margin],
        &[&accounts.btc_ledger, &accounts.eth_ledger],
        None,
        snapshot.clock.slot,
    )
}

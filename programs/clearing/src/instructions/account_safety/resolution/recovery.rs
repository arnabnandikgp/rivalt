//! Sustained source recovery returns to custody. Trading needs a separate fresh
//! qualification action and never resets earned funding or the market fee carry.
use super::*;
use math::oracle as policy;

pub(super) fn observe(
    safety: &mut VenueSafety,
    now: i64,
    normal: bool,
    resume: bool,
) -> Result<()> {
    require!(
        now > 0 && now >= safety.recovery_last,
        ClearingError::Resolution
    );
    let gap = now
        .checked_sub(safety.recovery_last)
        .ok_or(ClearingError::Arithmetic)?;
    if resume {
        require!(
            normal
                && safety.recovery_since > 0
                && safety
                    .recovery_last
                    .checked_sub(safety.recovery_since)
                    .is_some_and(|elapsed| elapsed >= policy::RECOVERY)
                && gap <= policy::HOLD,
            ClearingError::Resolution
        );
    } else {
        require!(
            safety.recovery_last == 0 || gap >= policy::SAMPLE_INTERVAL,
            ClearingError::Resolution
        );
        if normal {
            if safety.recovery_since == 0 || gap > policy::HOLD {
                safety.recovery_since = now;
            }
        } else {
            safety.recovery_since = 0;
        }
        safety.recovery_last = now;
    }
    Ok(())
}

fn no_liabilities(identity: &ResolutionIdentity, header: &Resolution, epoch: u64) -> Result<()> {
    profile(identity)?;
    require!(
        header.schema_version == SCHEMA_VERSION
            && header.epoch == epoch
            && identity.safety.resolution_epoch == epoch
            && identity.btc.gross_lots == 0
            && identity.eth.gross_lots == 0
            && identity.btc_ledger.settlement == 0
            && identity.eth_ledger.settlement == 0
            && [
                identity.btc.funding_index_scaled,
                identity.eth.funding_index_scaled
            ] == header.funding,
        ClearingError::Resolution
    );
    Ok(())
}

pub fn recover(
    ctx: &mut Context<RecoverAccounts>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
    resume: bool,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    no_liabilities(&accounts.identity, &accounts.resolution, epoch)?;
    require!(
        accounts.identity.safety.mode == RESOLVED
            && accounts.resolution.stage == COMPLETE
            && accounts.resolution.cursor == accounts.resolution.count
            && accounts.resolution.count == accounts.registry.count
            && accounts.resolution.registry_hash == registry_hash(&accounts.registry)?,
        ClearingError::Resolution
    );
    if resume {
        require_keys_eq!(
            accounts.caller.key(),
            accounts.identity.venue.authority,
            ClearingError::Authority
        );
    }
    let clock = Clock::get()?;
    let bounds = freeze::sources(
        &mut accounts.identity,
        &accounts.sources,
        clock.unix_timestamp,
    )?;
    let normal = bounds
        .iter()
        .all(|value| value.is_some_and(|bound| bound.normal));
    observe(
        &mut accounts.identity.safety,
        clock.unix_timestamp,
        normal,
        resume,
    )?;
    if resume {
        let skipped = u64::try_from(
            clock
                .unix_timestamp
                .checked_sub(accounts.resolution.frozen_at)
                .ok_or(ClearingError::Arithmetic)?,
        )
        .map_err(|_| error!(ClearingError::Resolution))?;
        for market in [&mut accounts.identity.btc, &mut accounts.identity.eth] {
            increment(&mut market.terms_epoch)?;
            increment(&mut market.config_epoch)?;
            let mut view = account_trading::market_view(market)?;
            crate::engine::oracle::reset_oracle(&mut view, clock.unix_timestamp, skipped)?;
            account_trading::commit_market(market, &view)?;
        }
        accounts.identity.safety.mode = CUSTODY;
        accounts.identity.safety.paused = false;
        increment(&mut accounts.identity.safety.epoch)?;
        increment(&mut accounts.identity.venue.terms_epoch)?;
        increment(&mut accounts.identity.venue.config_epoch)?;
        accounts.resolution.stage = RECOVERED;
        accounts.resolution.safety_epoch = accounts.identity.safety.epoch;
        accounts.resolution.terms_epoch = accounts.identity.venue.terms_epoch;
    }

    emit(
        &accounts.identity,
        &accounts.resolution,
        u8::from(resume),
        &clock,
        events,
        accounts.event_authority.to_account_info(),
    )
}

pub fn reactivate(
    ctx: &mut Context<RecoverAccounts>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    no_liabilities(&accounts.identity, &accounts.resolution, epoch)?;
    require_keys_eq!(
        accounts.caller.key(),
        accounts.identity.venue.authority,
        ClearingError::Authority
    );
    require!(
        accounts.identity.safety.mode == CUSTODY
            && !accounts.identity.safety.paused
            && accounts.resolution.stage == RECOVERED,
        ClearingError::Resolution
    );
    registry_hash(&accounts.registry)?;
    let clock = Clock::get()?;
    let bounds = freeze::sources(
        &mut accounts.identity,
        &accounts.sources,
        clock.unix_timestamp,
    )?;
    require!(
        bounds
            .iter()
            .all(|value| value.is_some_and(|bound| bound.normal)),
        ClearingError::OraclePolicy
    );
    // Custody operations cannot introduce q/claims/orders. New custody members
    // need not be excluded merely because the completed frozen cohort predates them.
    for market in [&mut accounts.identity.btc, &mut accounts.identity.eth] {
        account_trading::oracle::action(market, &clock, true)?;
        let mut view = account_trading::market_view(market)?;
        crate::engine::oracle::reset_oracle(&mut view, clock.unix_timestamp, 0)?;
        account_trading::commit_market(market, &view)?;
    }
    accounts.identity.safety.mode = ACTIVE;
    increment(&mut accounts.identity.safety.epoch)?;

    emit(
        &accounts.identity,
        &accounts.resolution,
        2,
        &clock,
        events,
        accounts.event_authority.to_account_info(),
    )
}

#[inline(never)]
fn emit(
    identity: &ResolutionIdentity,
    header: &Resolution,
    kind: u8,
    clock: &Clock,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountInfo,
) -> Result<()> {
    let event = Box::new(crate::events::AccountSafetyRecovery {
        venue: identity.venue.key(),

        slot: clock.slot,
        epoch: header.epoch,
        kind,
        mode: identity.safety.mode,
        paused: identity.safety.paused,
        safety_epoch: identity.safety.epoch,
        terms_epoch: identity.venue.terms_epoch,
        config_epoch: identity.venue.config_epoch,
        stage: header.stage,
        recovery_since: identity.safety.recovery_since,
        recovery_last: identity.safety.recovery_last,
        total_cash: account_custody::accounted_cash(
            &identity.custody,
            [&identity.btc_ledger, &identity.eth_ledger],
        )?,
        allocated_vault: identity.custody.allocated_vault,
        actual_vault: identity.vault.amount,
        markets: [
            crate::events::MarketSnapshot::from(&**identity.btc),
            crate::events::MarketSnapshot::from(&**identity.eth),
        ],
    });
    events.emit(&*event, authority)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_requires_sustained_samples_and_recent_final_observation() {
        let mut safety = VenueSafety::default();
        assert!(observe(&mut safety, 100, true, true).is_err());
        observe(&mut safety, 100, true, false).unwrap();
        assert!(observe(&mut safety, 101, true, false).is_err());
        assert!(observe(&mut safety, 99, true, false).is_err());
        for now in [102, 104] {
            observe(&mut safety, now, true, false).unwrap();
        }
        assert!(observe(&mut safety, 106, true, true).is_err());
        observe(&mut safety, 106, true, false).unwrap();
        assert!(observe(&mut safety, 106, false, true).is_err());
        observe(&mut safety, 112, true, true).unwrap();
        assert!(observe(&mut safety, 113, true, true).is_err());
        assert_eq!((safety.recovery_since, safety.recovery_last), (100, 106));
    }

    #[test]
    fn invalid_source_and_observation_gap_restart_the_full_recovery_window() {
        let mut safety = VenueSafety::default();
        observe(&mut safety, 100, true, false).unwrap();
        observe(&mut safety, 102, false, false).unwrap();
        assert_eq!(safety.recovery_since, 0);
        observe(&mut safety, 104, true, false).unwrap();
        observe(&mut safety, 111, true, false).unwrap();
        assert_eq!(safety.recovery_since, 111);
        for now in [113, 115, 117] {
            observe(&mut safety, now, true, false).unwrap();
        }
        observe(&mut safety, 117, true, true).unwrap();
    }

    #[test]
    fn historical_account_generations_are_not_live_liabilities() {
        let mut root = MarginAccount {
            schema_version: SCHEMA_VERSION,
            mode: MODE_CROSS,
            isolated_market_index: CROSS_MARKET_SENTINEL,
            role: ROLE_TRADER,
            nonce: 12,
            state_version: 19,
            delegate_epoch: 4,
            ..Default::default()
        };
        root.positions[0].generation = 3;
        root.positions[0].funding_checkpoint_scaled = 91;
        root.book.last_order_id = 17;
        account_custody::liability_free(&root).unwrap();
        root.positions[1].virtual_scaled = 1;
        assert!(account_custody::liability_free(&root).is_err());
        root.positions[1].virtual_scaled = 0;
        root.reserved = 1;
        assert!(account_custody::liability_free(&root).is_err());
        root.reserved = 0;
        root.book.orders[0].order.reserve = 1;
        assert!(account_custody::liability_free(&root).is_err());
    }
}

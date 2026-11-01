//! Qualified local activation requires precreated complete safety storage.
//! Earlier candidate transitions remain confined to their historical profiles.
use super::*;
use anchor_spl::token::TokenAccount;

#[event_cpi]
#[derive(Accounts)]
pub struct QualifyAccountTrading<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority, has_one = vault)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(mut, seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Box<Account<'info, Market>>,
    #[account(seeds = [b"ledger-v3", btc.key().as_ref()], bump = btc_ledger.bump, has_one = venue,
        constraint = btc_ledger.market == btc.key() @ ClearingError::Profile)]
    pub btc_ledger: Box<Account<'info, MarketLedger>>,
    #[account(seeds = [b"ledger-v3", eth.key().as_ref()], bump = eth_ledger.bump, has_one = venue,
        constraint = eth_ledger.market == eth.key() @ ClearingError::Profile)]
    pub eth_ledger: Box<Account<'info, MarketLedger>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.owner == venue.key() && vault.mint == venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct ActivateAccounts<'info> {
    pub qualification: QualifyAccountTrading<'info>,
    #[account(seeds = [b"resolution-v3", qualification.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == qualification.venue.key() @ ClearingError::Profile)]
    pub resolution: Box<Account<'info, Resolution>>,
}

fn storage_ready(header: &Resolution, safety: &VenueSafety) -> Result<()> {
    require!(
        header.schema_version == SCHEMA_VERSION
            && header.epoch == 0
            && header.stage == 0
            && usize::from(header.cursor) == MAX_MEMBERS / RESOLUTION_PAGE_ROWS
            && header.count == 0
            && safety.resolution_epoch == 0,
        ClearingError::Resolution
    );
    Ok(())
}

/// Candidate-only profile4 activation. Shared safety storage and oracle recovery
/// remain mandatory; the historical profile3 entrypoint cannot activate it.
pub fn activate_liquidity(
    ctx: &mut Context<ActivateAccounts>,
    events: &mut crate::event_cpi::Payloads,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty()
            && cfg!(feature = "liquidity-execution-qualification")
            && ctx.accounts.qualification.venue.profile_version == 4,
        ClearingError::Profile
    );
    storage_ready(&ctx.accounts.resolution, &ctx.accounts.qualification.safety)?;
    transition_accounts(&mut ctx.accounts.qualification, events)
}

fn transition_accounts(
    accounts: &mut QualifyAccountTrading,
    events: &mut crate::event_cpi::Payloads,
) -> Result<()> {
    base_profile(&accounts.venue, &accounts.custody, &accounts.safety)?;
    require!(!accounts.safety.paused, ClearingError::Paused);
    require!(
        accounts.safety.mode == CUSTODY && accounts.safety.resolution_epoch == 0,
        ClearingError::Profile
    );
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
        crate::engine::oracle::reset_oracle(&mut view, clock.unix_timestamp, 0)?;
        commit_market(market, &view)?;
    }
    accounts.safety.mode = ACTIVE;
    increment(&mut accounts.safety.epoch)?;

    let emitted = crate::events::AccountQualification {
        venue: accounts.venue.key(),

        slot: clock.slot,
        safety_epoch: accounts.safety.epoch,
        markets: [
            crate::events::MarketSnapshot::from(&**accounts.btc),
            crate::events::MarketSnapshot::from(&**accounts.eth),
        ],
    };
    events.emit(&emitted, accounts.event_authority.to_account_info())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_activation_rejects_retired_profiles_pauses_and_nontrading_modes() {
        let mut venue = Venue {
            schema_version: 7,
            profile_version: 4,
            market_count: 2,
            insurance_fee_share_bps: 2500,
            ..Default::default()
        };
        let custody = Custody {
            schema_version: 7,
            ..Default::default()
        };
        let mut safety = VenueSafety {
            schema_version: 7,
            mode: ACTIVE,
            ..Default::default()
        };
        assert_eq!(
            activated(&venue, &custody, &safety).is_ok(),
            cfg!(feature = "liquidity-execution-qualification")
        );
        for mode in [CUSTODY, FROZEN, RESOLVED, RETIRED] {
            safety.mode = mode;
            assert!(activated(&venue, &custody, &safety).is_err());
        }
        safety.mode = ACTIVE;
        safety.paused = true;
        assert!(activated(&venue, &custody, &safety).is_err());
        safety.paused = false;
        for version in [0, 1, 2, 3, 5] {
            venue.profile_version = version;
            assert!(activated(&venue, &custody, &safety).is_err());
        }
    }

    #[test]
    fn fresh_activation_requires_all_precreated_pages_and_no_previous_resolution() {
        let mut header = Resolution {
            schema_version: SCHEMA_VERSION,
            ..Default::default()
        };
        let mut safety = VenueSafety::default();
        for cursor in 0..32 {
            header.cursor = cursor;
            assert!(storage_ready(&header, &safety).is_err());
        }
        header.cursor = 32;
        storage_ready(&header, &safety).unwrap();
        header.epoch = 1;
        assert!(storage_ready(&header, &safety).is_err());
        header.epoch = 0;
        header.stage = 12;
        assert!(storage_ready(&header, &safety).is_err());
        header.stage = 0;
        safety.resolution_epoch = 1;
        assert!(storage_ready(&header, &safety).is_err());
    }
}

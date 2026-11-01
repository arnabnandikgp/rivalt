use super::*;
use crate::engine::oracle as shared;
use financial_core::oracle::Bounds;

pub(super) fn sources(
    identity: &mut ResolutionIdentity,
    feeds: &ResolutionSources,
    now: i64,
) -> Result<[Option<Bounds>; 2]> {
    let mut btc = account_trading::market_view(&identity.btc)?;
    let mut eth = account_trading::market_view(&identity.eth)?;
    let bounds = shared::sources(
        &mut btc,
        &mut eth,
        [
            &feeds.primary_btc,
            &feeds.primary_collateral,
            &feeds.guard_btc,
            &feeds.guard_collateral,
            &feeds.primary_eth,
            &feeds.guard_eth,
        ],
        now,
    )?;
    account_trading::commit_market(&mut identity.btc, &btc)?;
    account_trading::commit_market(&mut identity.eth, &eth)?;
    Ok(bounds)
}

/// The default trigger is economic insolvency, not conservative margin failure.
/// A flat mixed-sign cycle may have sufficient net equity but unpaid gross debt.
pub(super) fn authorized_prices(
    target: &MarginAccount,
    markets: [&Market; 2],
    bounds: [Option<Bounds>; 2],
    funding: [i128; 2],
    emergency: bool,
    authority: bool,
    now: i64,
) -> Result<[u64; 2]> {
    let model = account_trading::model(target)?;
    if emergency {
        require!(
            authority
                && markets.iter().enumerate().any(|(index, market)| {
                    bounds[index].is_none()
                        && market.gross_lots > 0
                        && market.oracle.source_deadline > 0
                        && market
                            .oracle
                            .source_deadline
                            .checked_add(30)
                            .is_some_and(|deadline| now >= deadline)
                }),
            ClearingError::Resolution
        );
    } else {
        let flat = target.positions.iter().all(|position| position.lots == 0);
        let target_credible = target
            .positions
            .iter()
            .enumerate()
            .all(|(index, position)| position.lots == 0 || bounds[index].is_some());
        require!(target_credible, ClearingError::Resolution);
        let prices = bounds.map(|bound| bound.map_or(1, |value| value.reference));
        let claims = checked(model.claims(prices, funding))?;
        let gross_debt = claims.into_iter().try_fold(0u128, |total, claim| {
            total
                .checked_add(claim.min(0).unsigned_abs())
                .ok_or(ClearingError::Arithmetic)
        })?;
        require!(
            checked(model.net_equity(prices, funding))? < 0
                || (flat && gross_debt > u128::from(target.cash) * math::SCALE as u128),
            ClearingError::Resolution
        );
    }
    required_prices(markets, bounds)
}

fn required_prices(markets: [&Market; 2], bounds: [Option<Bounds>; 2]) -> Result<[u64; 2]> {
    if markets
        .iter()
        .enumerate()
        .any(|(index, market)| market.gross_lots > 0 && bounds[index].is_none())
    {
        return Ok([0; 2]);
    }
    // No exposure anywhere means this price cannot change any claim. Use a fixed
    // in-range sentinel, never a keeper-selected stale valuation.
    Ok(core::array::from_fn(|index| {
        bounds[index].map_or(1, |value| value.reference)
    }))
}

fn coverage(market: &mut Market, now: i64) -> Result<()> {
    let mut view = account_trading::market_view(market)?;
    shared::freeze_coverage(&mut view, now)?;
    account_trading::commit_market(market, &view)
}

pub fn freeze(
    ctx: &mut Context<FreezeAccounts>,
    events: &mut crate::event_cpi::Payloads,
    expected_safety_epoch: u64,
    expected_resolution_epoch: u64,
    emergency: bool,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    profile(&accounts.identity)?;
    let header = &mut accounts.resolution;
    require!(
        accounts.identity.safety.mode == ACTIVE
            && accounts.identity.safety.epoch == expected_safety_epoch
            && header.schema_version == SCHEMA_VERSION
            && header.epoch == expected_resolution_epoch
            && ((header.stage == IDLE && header.cursor == PAGE_COUNT) || header.stage == RECOVERED)
            && accounts.work.schema_version == SCHEMA_VERSION
            && accounts.registry.members.get(accounts.target.id as usize)
                == Some(&accounts.target.key()),
        ClearingError::Resolution
    );
    let registry_hash = registry_hash(&accounts.registry)?;
    let clock = Clock::get()?;
    let bounds = sources(
        &mut accounts.identity,
        &accounts.sources,
        clock.unix_timestamp,
    )?;
    account_trading::materialize(
        [&mut accounts.identity.btc, &mut accounts.identity.eth],
        &clock,
    )?;
    let funding = [
        accounts.identity.btc.funding_index_scaled,
        accounts.identity.eth.funding_index_scaled,
    ];
    let prices = authorized_prices(
        &accounts.target,
        [&accounts.identity.btc, &accounts.identity.eth],
        bounds,
        funding,
        emergency,
        accounts.caller.key() == accounts.identity.venue.authority,
        clock.unix_timestamp,
    )?;
    coverage(&mut accounts.identity.btc, clock.unix_timestamp)?;
    coverage(&mut accounts.identity.eth, clock.unix_timestamp)?;
    increment(&mut header.epoch)?;
    increment(&mut accounts.identity.safety.epoch)?;
    increment(&mut accounts.identity.venue.terms_epoch)?;
    for market in [&mut accounts.identity.btc, &mut accounts.identity.eth] {
        increment(&mut market.terms_epoch)?;
    }
    accounts.identity.safety.mode = FROZEN;
    accounts.identity.safety.paused = true;
    accounts.identity.safety.resolution_epoch = header.epoch;
    accounts.identity.safety.recovery_since = 0;
    accounts.identity.safety.recovery_last = 0;
    header.stage = if prices == [0; 2] {
        AWAIT_VALUATION
    } else {
        VALUE
    };
    header.cursor = 0;
    header.count = accounts.registry.count;
    header.registry_hash = registry_hash;
    header.safety_epoch = accounts.identity.safety.epoch;
    header.terms_epoch = accounts.identity.venue.terms_epoch;
    let markets = [&accounts.identity.btc, &accounts.identity.eth];
    header.config_epochs = markets.map(|market| market.config_epoch);
    header.source_observations = markets.map(|market| market.observation_sequence);
    header.source_deadlines = markets.map(|market| market.oracle.source_deadline);
    header.prices = prices;
    header.funding = funding;
    header.frozen_at = clock.unix_timestamp;
    header.cash_before = account_custody::accounted_cash(
        &accounts.identity.custody,
        [&accounts.identity.btc_ledger, &accounts.identity.eth_ledger],
    )?;
    let ledgers = [&accounts.identity.btc_ledger, &accounts.identity.eth_ledger];
    header.pools_before = ledgers.map(|ledger| ledger.settlement);
    header.insurance_before = ledgers.map(|ledger| ledger.insurance);
    header.fees_before = ledgers.map(|ledger| ledger.fees);
    header.allocated_before = accounts.identity.custody.allocated_vault;
    header.remaining_gross = markets.map(|market| market.gross_lots);
    header.remaining_lots = [0; 2];
    header.remaining_claims = header
        .pools_before
        .map(|pool| i128::from(pool) * math::SCALE);
    header.scanned_cash = 0;
    header.scanned_lots = [0; 2];
    header.scanned_gross = [0; 2];
    header.claim_sums = [0; 2];
    header.positive_scaled = [0; 2];
    header.budgets = header.insurance_before;
    header.insurance_spent = [0; 2];
    header.evaluation = 0;
    header.clipped_mask = 0;
    header.cash_applied = 0;
    header.proposal_hash = [0; 32];
    header.proposal_uploaded = 0;
    header.rate_factor = [0; 3];
    header.common.limbs.fill(0);
    header.flow_denominator.limbs.fill(0);
    for rate in &mut header.rate_numerators {
        rate.limbs.fill(0);
    }
    let work = &mut accounts.work;
    work.epoch = header.epoch;
    work.opcode = header.stage;
    work.row = 0;
    work.limb_cursor = 0;
    for register in &mut work.registers {
        register.limbs.fill(0);
    }
    work.residual_capacity.fill(0);
    work.market_edge_order = [[0; MAX_MEMBERS]; 2];
    work.visited_members = 0;
    work.parents.fill(0);
    work.dfs_next.fill(0);
    work.dfs_path.fill(0);
    work.depth = 0;
    work.augmentations = 0;

    frozen(&accounts.identity, &accounts.registry, header, header.epoch)?;
    emit(
        &accounts.identity,
        header,
        accounts.target.key(),
        emergency,
        &clock,
        events,
        accounts.event_authority.to_account_info(),
    )
}

pub fn value_sources(
    ctx: &mut Context<ValueAccountResolution>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    frozen(
        &accounts.identity,
        &accounts.registry,
        &accounts.resolution,
        epoch,
    )?;
    require!(
        accounts.resolution.stage == AWAIT_VALUATION,
        ClearingError::Resolution
    );
    let clock = Clock::get()?;
    let bounds = sources(
        &mut accounts.identity,
        &accounts.sources,
        clock.unix_timestamp,
    )?;
    let prices = required_prices([&accounts.identity.btc, &accounts.identity.eth], bounds)?;
    require!(prices != [0; 2], ClearingError::Resolution);
    accounts.resolution.prices = prices;
    accounts.resolution.stage = VALUE;

    frozen(
        &accounts.identity,
        &accounts.registry,
        &accounts.resolution,
        epoch,
    )?;
    emit(
        &accounts.identity,
        &accounts.resolution,
        Pubkey::default(),
        false,
        &clock,
        events,
        accounts.event_authority.to_account_info(),
    )
}

#[inline(never)]
fn emit(
    identity: &ResolutionIdentity,
    header: &Resolution,
    trigger: Pubkey,
    emergency: bool,
    clock: &Clock,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountInfo,
) -> Result<()> {
    events.emit(
        &crate::events::AccountResolutionFrozen {
            venue: identity.venue.key(),

            slot: clock.slot,
            epoch: header.epoch,
            stage: header.stage,
            trigger,
            emergency,
            count: header.count,
            registry_hash: header.registry_hash,
            safety_epoch: header.safety_epoch,
            terms_epoch: header.terms_epoch,
            config_epochs: header.config_epochs,
            source_observations: header.source_observations,
            source_deadlines: header.source_deadlines,
            prices: header.prices,
            funding: header.funding,
            frozen_at: header.frozen_at,
            cash: header.cash_before,
            pools: header.pools_before,
            insurance: header.insurance_before,
            fees: header.fees_before,
            allocated: header.allocated_before,
            gross: header.remaining_gross,
            actual_vault: identity.vault.amount,
            markets: [
                crate::events::MarketSnapshot::from(&**identity.btc),
                crate::events::MarketSnapshot::from(&**identity.eth),
            ],
        },
        authority,
    )
}

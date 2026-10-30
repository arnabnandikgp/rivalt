//! Frozen complete-group authority and monotonic page dispatch.
pub(crate) use crate::engine::oracle::{sources, freeze_coverage};
use super::*;
pub use crate::constants::resolution::*;
use anchor_spl::token::TokenAccount;
use financial_core::oracle as policy;
mod ledger;
#[cfg(test)]
mod tests;

#[event_cpi]
#[derive(Accounts)]
pub struct FreezeGroup<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"registry-v2", group.key().as_ref()], bump = registry.bump, has_one = group)]
    pub registry: Box<Account<'info, GroupRegistryV2>>,
    #[account(mut, seeds = [b"resolution-v2", group.key().as_ref()], bump = resolution.bump, has_one = group)]
    pub resolution: Box<Account<'info, GroupResolutionV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(seeds = [b"margin-v2", target.portfolio.as_ref(), &target.subaccount_index.to_le_bytes()], bump = target.bump, has_one = group)]
    pub target: Box<Account<'info, MarginAccountV2>>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub guard_collateral: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub primary_eth: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub guard_eth: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdvanceGroupResolution<'info> {
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"registry-v2", group.key().as_ref()], bump = registry.bump, has_one = group)]
    pub registry: Box<Account<'info, GroupRegistryV2>>,
    #[account(mut, seeds = [b"resolution-v2", group.key().as_ref()], bump = resolution.bump, has_one = group)]
    pub resolution: Box<Account<'info, GroupResolutionV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RecoverGroupResolution<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"registry-v2", group.key().as_ref()], bump = registry.bump, has_one = group)]
    pub registry: Box<Account<'info, GroupRegistryV2>>,
    #[account(mut, seeds = [b"resolution-v2", group.key().as_ref()], bump = resolution.bump, has_one = group)]
    pub resolution: Box<Account<'info, GroupResolutionV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub guard_collateral: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub primary_eth: UncheckedAccount<'info>,
    /// CHECK: exact configured identity, program owner, feed and monotonic sequence authenticated by sources().
    pub guard_eth: UncheckedAccount<'info>,
}




pub(crate) fn cash_invariant(
    group: &ClearingGroupV2,
    header: &GroupResolutionHeaderV2,
    actual: u64,
) -> Result<()> {
    let insurance = if header.insurance_moved {
        header.insured_atoms
    } else {
        0
    };
    require!(
        group.total_cash
            == checked(math::cash_add(
                checked(math::cash_sub(header.initial_cash, header.collected_total))?,
                header.paid_applied
            ))?
            && group.settlement
                == checked(math::cash_sub(
                    checked(math::cash_add(
                        checked(math::cash_add(header.initial_pool, header.collected_total))?,
                        insurance
                    ))?,
                    header.paid_applied
                ))?
            && group.insurance == checked(math::cash_sub(header.initial_insurance, insurance))?
            && group.fees == header.initial_fees
            && group.allocated_vault == header.initial_vault,
        ClearingError::Reconciliation
    );
    group_custody::reconciled(group, actual)
}
fn frozen(
    group: &ClearingGroupV2,
    markets: [&GroupMarketV2; 2],
    registry: &GroupRegistryV2,
    resolution: &GroupResolutionV2,
    actual: u64,
    epoch: u64,
) -> Result<()> {
    require!(
        cfg!(feature = "successor-test-profile")
            && group.schema_version == SCHEMA_VERSION
            && group.profile_version == PROFILE_VERSION
            && group.market_count == 2
            && group.mode == 3
            && group.paused
            && resolution.schema_version == SCHEMA_VERSION,
        ClearingError::Profile
    );
    let header = &resolution.header;
    require!(
        header.epoch == epoch
            && (AWAIT_VALUATION..=COMPLETE).contains(&header.stage)
            && header.count == registry.count
            && header.registry_hash == registry_hash(registry)?
            && resolution.rows.len() == usize::from(header.count)
            && markets.map(|market| market.funding_index_scaled) == header.funding
            && markets.map(|market| market.gross_lots) == header.remaining_gross,
        ClearingError::Resolution
    );
    cash_invariant(group, header, actual)
}

#[inline(never)]
fn event(
    group: &Account<ClearingGroupV2>,
    markets: [&GroupMarketV2; 2],
    resolution: &GroupResolutionV2,
    kind: u8,
    rows: Vec<crate::events::GroupResolutionUpdateV2>,
    roots: Vec<crate::events::MarginAccountSnapshotV2>,
    actual: u64,
    clock: &Clock,
) -> Box<crate::events::GroupResolutionProgressV2> {
    Box::new(crate::events::GroupResolutionProgressV2 {
        group: group.key(),
        sequence: group.sequence,
        slot: clock.slot,
        kind,
        mode: group.mode,
        paused: group.paused,
        terms_epoch: group.terms_epoch,
        config_epoch: group.config_epoch,
        markets: markets.map(crate::events::GroupMarketSnapshotV2::from),
        header: resolution.header,
        rows,
        roots,
        total_cash: group.total_cash,
        settlement: group.settlement,
        insurance: group.insurance,
        fees: group.fees,
        allocated_vault: group.allocated_vault,
        actual_vault: actual,
    })
}



/// The caller authenticates both sources and the complete target identity.
/// A conservative risk deficit alone does not authorize default. Missing prices
/// authorize only the explicit group-authority emergency after exposed-source
/// grace, and pin no partial valuation.
fn freeze_prices(
    target: &MarginAccountV2,
    markets: [&GroupMarketV2; 2],
    bounds: [Option<policy::Bounds>; 2],
    funding: [i128; 2],
    emergency: bool,
    authority: bool,
    now: i64,
) -> Result<[u64; 2]> {
    if let [Some(btc), Some(eth)] = bounds {
        require!(
            !emergency
                && checked(
                    crate::instructions::group_margin::model(target)?
                        .net_equity([btc.reference, eth.reference], funding)
                )? < 0,
            ClearingError::Resolution
        );
        return Ok([btc.reference, eth.reference]);
    }
    require!(
        emergency
            && authority
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
    Ok([0; 2])
}

pub fn freeze(
    ctx: Context<FreezeGroup>,
    sequence: u64,
    observations: [u64; 2],
    emergency: bool,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    // An administrative pause must not prevent insolvency resolution.
    require!(
        cfg!(feature = "successor-test-profile")
            && ISOLATED_TRADING_IMPLEMENTED
            && accounts.group.schema_version == SCHEMA_VERSION
            && accounts.group.profile_version == PROFILE_VERSION
            && accounts.group.market_count == 2
            && (accounts.group.mode == 1 || (cross_profile_enabled() && accounts.group.mode == 2)),
        ClearingError::Profile
    );
    require!(
        accounts.group.sequence == sequence
            && [
                accounts.btc.observation_sequence,
                accounts.eth.observation_sequence
            ] == observations,
        ClearingError::FinancialSequence
    );
    markets(
        &accounts.group,
        accounts.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    require!(
        accounts.resolution.schema_version == SCHEMA_VERSION
            && matches!(accounts.resolution.header.stage, IDLE | RESUMED)
            && accounts
                .registry
                .members
                .get(usize::from(accounts.target.id))
                == Some(&accounts.target.key()),
        ClearingError::Resolution
    );
    let identity = registry_hash(&accounts.registry)?;
    let clock = Clock::get()?;
    let bounds = sources(
        &mut accounts.btc,
        &mut accounts.eth,
        [
            &accounts.primary_btc,
            &accounts.primary_collateral,
            &accounts.guard_btc,
            &accounts.guard_collateral,
            &accounts.primary_eth,
            &accounts.guard_eth,
        ],
        clock.unix_timestamp,
    )?;
    oracle::materialize(accounts.group.mode, &mut accounts.btc, &clock)?;
    oracle::materialize(accounts.group.mode, &mut accounts.eth, &clock)?;
    let funding = [
        accounts.btc.funding_index_scaled,
        accounts.eth.funding_index_scaled,
    ];
    account_model(&accounts.target)?;
    let prices = freeze_prices(
        &accounts.target,
        [&accounts.btc, &accounts.eth],
        bounds,
        funding,
        emergency,
        accounts.caller.key() == accounts.group.authority,
        clock.unix_timestamp,
    )?;
    freeze_coverage(&mut accounts.btc, clock.unix_timestamp)?;
    freeze_coverage(&mut accounts.eth, clock.unix_timestamp)?;
    let header = GroupResolutionHeaderV2 {
        epoch: next(accounts.resolution.header.epoch)?,
        stage: if prices == [0; 2] {
            AWAIT_VALUATION
        } else {
            VALUE
        },
        count: accounts.registry.count,
        registry_hash: identity,
        prices,
        funding,
        frozen_at: clock.unix_timestamp,
        initial_cash: accounts.group.total_cash,
        initial_pool: accounts.group.settlement,
        initial_insurance: accounts.group.insurance,
        initial_fees: accounts.group.fees,
        initial_vault: accounts.group.allocated_vault,
        remaining_gross: [accounts.btc.gross_lots, accounts.eth.gross_lots],
        ..Default::default()
    };
    accounts.resolution.header = header;
    accounts.resolution.rows.clear();
    accounts
        .resolution
        .rows
        .resize(usize::from(header.count), GroupResolutionRowV2::default());
    accounts.group.mode = 3;
    accounts.group.paused = true;
    accounts.group.terms_epoch = next(accounts.group.terms_epoch)?;
    accounts.group.config_epoch = next(accounts.group.config_epoch)?;
    for market in [&mut accounts.btc, &mut accounts.eth] {
        market.terms_epoch = next(market.terms_epoch)?;
        market.config_epoch = next(market.config_epoch)?;
    }
    accounts.group.sequence = next(accounts.group.sequence)?;
    cash_invariant(&accounts.group, &header, accounts.vault.amount)?;
    let emitted = event(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        &accounts.resolution,
        0,
        vec![],
        vec![],
        accounts.vault.amount,
        &clock,
    );
    crate::event_cpi::emit(&*emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}

pub fn advance(
    ctx: Context<AdvanceGroupResolution>,
    epoch: u64,
    stage: u8,
    start: u16,
) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    markets(
        &accounts.group,
        accounts.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    frozen(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        &accounts.registry,
        &accounts.resolution,
        accounts.vault.amount,
        epoch,
    )?;
    require!(
        (VALUE..=RECONCILE).contains(&stage)
            && accounts.resolution.header.stage == stage
            && accounts.resolution.header.cursor == start,
        ClearingError::Resolution
    );
    let length = ctx.remaining_accounts.len();
    require!(
        (1..=4).contains(&length)
            && usize::from(start) + length <= usize::from(accounts.resolution.header.count),
        ClearingError::Resolution
    );
    let writable = matches!(stage, COLLECT | APPLY);
    let mut rows = Vec::with_capacity(length);
    let mut roots = Vec::new();
    for (offset, info) in ctx.remaining_accounts.iter().enumerate() {
        let id = usize::from(start) + offset;
        let mut root = member(info, accounts.group.key(), &accounts.registry, id, writable)?;
        ledger::process_row(
            &mut accounts.group,
            &mut [&mut accounts.btc, &mut accounts.eth],
            &mut accounts.resolution,
            id,
            &mut root,
        )?;
        if writable {
            root.try_serialize(&mut &mut info.try_borrow_mut_data()?[..])?;
            roots.push(crate::events::MarginAccountSnapshotV2::from(&root));
        }
        rows.push(crate::events::GroupResolutionUpdateV2 {
            id: id as u16,
            row: accounts.resolution.rows[id],
        });
    }
    accounts.resolution.header.cursor += length as u16;
    if accounts.resolution.header.cursor == accounts.resolution.header.count {
        ledger::finish_pass(
            &mut accounts.group,
            &mut [&mut accounts.btc, &mut accounts.eth],
            &mut accounts.resolution.header,
        )?;
    }
    cash_invariant(
        &accounts.group,
        &accounts.resolution.header,
        accounts.vault.amount,
    )?;
    accounts.group.sequence = next(accounts.group.sequence)?;
    let emitted = event(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        &accounts.resolution,
        1,
        rows,
        roots,
        accounts.vault.amount,
        &Clock::get()?,
    );
    crate::event_cpi::emit(&*emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}

pub fn recover(ctx: Context<RecoverGroupResolution>, epoch: u64, resume: bool) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    markets(
        &accounts.group,
        accounts.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    frozen(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        &accounts.registry,
        &accounts.resolution,
        accounts.vault.amount,
        epoch,
    )?;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let bounds = sources(
        &mut accounts.btc,
        &mut accounts.eth,
        [
            &accounts.primary_btc,
            &accounts.primary_collateral,
            &accounts.guard_btc,
            &accounts.guard_collateral,
            &accounts.primary_eth,
            &accounts.guard_eth,
        ],
        now,
    )?;
    let header = &mut accounts.resolution.header;
    let mut kind = 2;
    if header.stage == AWAIT_VALUATION {
        require!(!resume, ClearingError::Resolution);
        let [Some(btc), Some(eth)] = bounds else {
            return err!(ClearingError::OraclePolicy);
        };
        header.prices = [btc.reference, eth.reference];
        header.stage = VALUE;
    } else {
        require!(header.stage == COMPLETE, ClearingError::Resolution);
        let normal = bounds
            .iter()
            .all(|bounds| bounds.is_some_and(|bounds| bounds.normal));
        if resume {
            require_keys_eq!(
                accounts.caller.key(),
                accounts.group.authority,
                ClearingError::Authority
            );
            require!(
                ISOLATED_TRADING_IMPLEMENTED
                    && normal
                    && header.recovery_since > 0
                    && header.recovery_last - header.recovery_since >= policy::RECOVERY
                    && now >= header.recovery_last
                    && now - header.recovery_last <= policy::HOLD,
                ClearingError::Resolution
            );
            accounts.group.mode = 1;
            accounts.group.paused = false;
            accounts.group.terms_epoch = next(accounts.group.terms_epoch)?;
            accounts.group.config_epoch = next(accounts.group.config_epoch)?;
            for market in [&mut accounts.btc, &mut accounts.eth] {
                market.terms_epoch = next(market.terms_epoch)?;
                market.config_epoch = next(market.config_epoch)?;
                settlement::reset_oracle(
                    market,
                    now,
                    u64::try_from(
                        now.checked_sub(header.frozen_at)
                            .ok_or(ClearingError::Arithmetic)?,
                    )
                    .map_err(|_| error!(ClearingError::Resolution))?,
                )?;
            }
            header.stage = RESUMED;
            kind = 3;
        } else {
            require!(
                header.recovery_last == 0 || now - header.recovery_last >= policy::SAMPLE_INTERVAL,
                ClearingError::Resolution
            );
            if normal {
                if header.recovery_since == 0 || now - header.recovery_last > policy::HOLD {
                    header.recovery_since = now;
                }
            } else {
                header.recovery_since = 0;
            }
            header.recovery_last = now;
        }
    }
    accounts.group.sequence = next(accounts.group.sequence)?;
    let emitted = event(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        &accounts.resolution,
        kind,
        vec![],
        vec![],
        accounts.vault.amount,
        &clock,
    );
    crate::event_cpi::emit(&*emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}
